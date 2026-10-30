// filepath: apps/api/src/documents/runner.ts
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { transaction } from "../db.js";
import { audit } from "../audit.js";
import { PdfRenderer } from "./renderer.js";
import { DocumentStorage } from "./storage.js";
import { digest } from "./jobs.js";
type Delivery = { id: string; requester: string };
export class DocumentRunner {
  private storage: DocumentStorage;
  private queue: Queue;
  private worker: Worker;
  private producer: Redis;
  private consumer: Redis;
  private timer?: ReturnType<typeof setInterval>;
  private dispatching: Promise<void> | null = null;
  constructor(
    private pool: Pool,
    private config: AppConfig,
    private report: (event: string) => void,
    private render = (html: string) => new PdfRenderer(config).render(html),
  ) {
    if (!config.REDIS_URL)
      throw new Error("REDIS_URL is required for the document worker");
    this.storage = new DocumentStorage(config);
    this.producer = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.consumer = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.producer.on("error", () => report("documents.redis.unavailable"));
    this.consumer.on("error", () => report("documents.redis.unavailable"));
    this.queue = new Queue(config.PDF_QUEUE_NAME, {
      connection: this.producer,
    });
    this.queue.on("error", () => report("documents.queue.error"));
    this.worker = new Worker<Delivery>(
      config.PDF_QUEUE_NAME,
      (job) => this.process(job.data),
      { connection: this.consumer, concurrency: config.PDF_CONCURRENCY },
    );
    this.worker.on("error", () => report("documents.worker.error"));
  }
  start() {
    this.timer = setInterval(() => {
      void this.dispatch();
    }, 1000);
    this.timer.unref();
    void this.dispatch();
  }
  async dispatch() {
    if (this.dispatching) return this.dispatching;
    this.dispatching = (async () => {
      try {
        const pending = await this.pool.query(
          "SELECT job_id,requested_by FROM document_outbox WHERE available_at<=now() ORDER BY available_at LIMIT 100",
        );
        for (const row of pending.rows)
          await this.queue.add(
            "render",
            { id: row.job_id, requester: row.requested_by },
            { jobId: row.job_id, removeOnComplete: true, removeOnFail: true },
          );
      } catch {
        this.report("documents.dispatch.deferred");
      }
    })().finally(() => {
      this.dispatching = null;
    });
    return this.dispatching;
  }
  async process(delivery: Delivery) {
    const token = randomUUID(),
      lease = Math.ceil(this.config.PDF_TIMEOUT_MS / 1000) + 30;
    const job = await transaction(this.pool, delivery.requester, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM document_jobs WHERE id=$1 AND requested_by=$2 FOR UPDATE",
          [delivery.id, delivery.requester],
        )
      ).rows[0];
      if (!row) return null;
      if (row.status === "ready" || row.status === "failed") {
        await db.query("DELETE FROM document_outbox WHERE job_id=$1", [row.id]);
        return null;
      }
      if (row.status === "processing" && new Date(row.lease_until) > new Date())
        return null;
      const allowed = (
        await db.query(
          "SELECT has_permission($1,'shipment.read',$2) AND has_permission($1,'document.download',$2) AS ok",
          [row.tenant_id, row.shipment_id],
        )
      ).rows[0].ok;
      if (!allowed || row.attempts >= 3) {
        await db.query(
          "UPDATE document_jobs SET status='failed',error_code=$2,completed_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1",
          [row.id, allowed ? "attempts_exhausted" : "access_revoked"],
        );
        await db.query("DELETE FROM document_outbox WHERE job_id=$1", [row.id]);
        await audit(
          db,
          delivery.requester,
          row.tenant_id,
          "document.draft_failed",
          row.id,
          { reason: allowed ? "attempts_exhausted" : "access_revoked" },
        );
        return null;
      }
      await db.query(
        "UPDATE document_jobs SET status='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+($3*interval '1 second') WHERE id=$1",
        [row.id, token, lease],
      );
      await db.query(
        "UPDATE document_outbox SET available_at=now()+($2*interval '1 second') WHERE job_id=$1",
        [row.id, lease],
      );
      return row;
    });
    if (!job) return;
    try {
      if (digest(job.html) !== job.snapshot_hash)
        throw new Error("Snapshot hash mismatch");
      const bytes = await this.render(job.html);
      if (
        bytes.length > 10485760 ||
        bytes.subarray(0, 5).toString() !== "%PDF-"
      )
        throw new Error("Invalid PDF output");
      await transaction(this.pool, delivery.requester, async (db) => {
        const current = (
          await db.query(
            "SELECT status,lease_token FROM document_jobs WHERE id=$1 FOR UPDATE",
            [job.id],
          )
        ).rows[0];
        if (current?.status !== "processing" || current.lease_token !== token)
          return;
        // The requesting account may have lost access while Chromium was rendering.
        const allowed = (
          await db.query(
            "SELECT has_permission($1,'shipment.read',$2) AND has_permission($1,'document.download',$2) AS ok",
            [job.tenant_id, job.shipment_id],
          )
        ).rows[0].ok;
        if (!allowed) throw new Error("Access revoked");
        const file = await this.storage.save(
          job.tenant_id,
          job.id,
          token,
          bytes,
        );
        await db.query(
          "INSERT INTO document_files(job_id,bytes,sha256,object_key,object_bucket,object_version,byte_size) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            job.id,
            file.bytes,
            file.sha256,
            file.object_key,
            file.object_bucket,
            file.object_version,
            file.byte_size,
          ],
        );
        await db.query(
          "UPDATE document_jobs SET status='ready',completed_at=now(),lease_token=NULL,lease_until=NULL,error_code=NULL WHERE id=$1",
          [job.id],
        );
        await db.query("DELETE FROM document_outbox WHERE job_id=$1", [job.id]);
        await audit(
          db,
          delivery.requester,
          job.tenant_id,
          "document.draft_ready",
          job.id,
          { shipmentId: job.shipment_id, sha256: digest(bytes) },
        );
      });
    } catch {
      await transaction(this.pool, delivery.requester, async (db) => {
        const result = await db.query(
          "UPDATE document_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,error_code='render_failed',lease_token=NULL,lease_until=NULL,completed_at=CASE WHEN attempts>=3 THEN now() ELSE NULL END WHERE id=$1 AND lease_token=$2 RETURNING status,attempts",
          [job.id, token],
        );
        if (!result.rowCount) return;
        if (result.rows[0].status === "failed") {
          await audit(
            db,
            delivery.requester,
            job.tenant_id,
            "document.draft_failed",
            job.id,
            { reason: "render_failed" },
          );
          await db.query("DELETE FROM document_outbox WHERE job_id=$1", [
            job.id,
          ]);
        } else
          await db.query(
            "UPDATE document_outbox SET available_at=now()+($2*interval '1 second') WHERE job_id=$1",
            [job.id, 2 ** result.rows[0].attempts],
          );
      });
      this.report("documents.render.failed");
    }
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.dispatching;
    await this.worker.close();
    await this.queue.close();
    this.producer.disconnect();
    this.consumer.disconnect();
    this.storage.close();
  }
}
