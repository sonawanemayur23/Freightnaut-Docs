// filepath: apps/api/src/documents/jobs.ts
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { shipmentSchema, renderDocument } from "@freightnaut/domain";
import { transaction } from "../db.js";
import { authorize, settingsFor, uuid } from "../tenancy/service.js";
import { assert } from "../errors.js";
import type { AppConfig } from "../config.js";
import { DocumentStorage } from "./storage.js";
import { audit } from "../audit.js";
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const summary = `id,document_type AS "documentType",shipment_version AS "shipmentVersion",status,attempts,error_code AS "errorCode",created_at AS "createdAt",completed_at AS "completedAt",snapshot_hash AS "snapshotHash",snapshot->'numberReservation'->>'number' AS "documentNumber"`;
export function registerDocumentJobs(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
) {
  const storage = new DocumentStorage(config);
  app.addHook("onClose", async () => storage.close());
  const root = "/api/tenants/:tenantId/shipments/:shipmentId/document-jobs";
  type Params = { tenantId: string; shipmentId: string; jobId: string };
  app.post<{ Params: Params }>(
    root,
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const tenant = uuid(request.params.tenantId),
        shipment = uuid(request.params.shipmentId),
        actor = request.actor!;
      const input = z
        .strictObject({
          version: z.number().int().positive(),
          type: z.enum(["invoice", "packing-list"]),
          idempotencyKey: z.uuid(),
        })
        .parse(request.body);
      const result = await transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenant, "shipment.read", shipment);
        await authorize(db, actor, tenant, "document.download", shipment);
        // Serialize per requester to bound pending work even across concurrent API requests.
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          actor.id,
        ]);
        const existing = (
          await db.query(
            `SELECT ${summary},shipment_id,idempotency_key FROM document_jobs WHERE tenant_id=$1 AND requested_by=$2 AND idempotency_key=$3`,
            [tenant, actor.id, input.idempotencyKey],
          )
        ).rows[0];
        if (existing) {
          assert(
            existing.shipment_id === shipment &&
              existing.shipmentVersion === input.version &&
              existing.documentType === input.type,
            409,
            "This request key was already used for another document.",
          );
          return existing;
        }
        const row = (
          await db.query(
            "SELECT data,version FROM shipments WHERE tenant_id=$1 AND id=$2",
            [tenant, shipment],
          )
        ).rows[0];
        assert(row, 404, "Shipment not found.");
        assert(
          row.version === input.version,
          409,
          "The shipment changed. Reload before preparing the document.",
        );
        const count = (
          await db.query(
            "SELECT count(*)::int AS n FROM document_jobs WHERE requested_by=$1 AND status IN ('queued','processing')",
            [actor.id],
          )
        ).rows[0].n;
        assert(
          count < 10,
          429,
          "You already have several documents being prepared. Wait for them to finish.",
        );
        const settings = await settingsFor(db, tenant),
          data = shipmentSchema.parse(row.data);
        const numberReservation =
          (
            await db.query(
              "SELECT id,number,series_revision AS revision,branch FROM number_reservations WHERE tenant_id=$1 AND shipment_id=$2 AND document_type=$3 AND status='reserved'",
              [tenant, shipment, input.type],
            )
          ).rows[0] ?? null;
        const snapshot = {
          shipment: data,
          numberReservation,
          settings: settings.values,
          settingsRevision: settings.revision,
          renderer: "html-draft-v2-numbering",
        };
        const html = renderDocument(
          data,
          input.type,
          settings.values,
          numberReservation?.number,
        );
        const job = (
          await db.query(
            `INSERT INTO document_jobs(tenant_id,shipment_id,requested_by,idempotency_key,document_type,shipment_version,snapshot,html,snapshot_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${summary}`,
            [
              tenant,
              shipment,
              actor.id,
              input.idempotencyKey,
              input.type,
              row.version,
              JSON.stringify(snapshot),
              html,
              digest(html),
            ],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO document_outbox(job_id,requested_by) VALUES($1,$2)",
          [job.id, actor.id],
        );
        await audit(db, actor.id, tenant, "document.draft_requested", job.id, {
          shipmentId: shipment,
          type: input.type,
          shipmentVersion: row.version,
        });
        return job;
      });
      return reply.code(202).send(result);
    },
  );
  app.get<{ Params: Params }>(root, async (request) =>
    transaction(pool, request.actor!.id, async (db) => {
      const tenant = uuid(request.params.tenantId),
        shipment = uuid(request.params.shipmentId);
      await authorize(db, request.actor!, tenant, "shipment.read", shipment);
      await authorize(
        db,
        request.actor!,
        tenant,
        "document.download",
        shipment,
      );
      const jobs = await db.query(
        `SELECT ${summary} FROM document_jobs WHERE tenant_id=$1 AND shipment_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50`,
        [tenant, shipment],
      );
      return { jobs: jobs.rows };
    }),
  );
  app.get<{ Params: Params }>(root + "/:jobId/file", async (request, reply) => {
    const result = await transaction(pool, request.actor!.id, async (db) => {
      const tenant = uuid(request.params.tenantId),
        shipment = uuid(request.params.shipmentId),
        id = uuid(request.params.jobId);
      await authorize(db, request.actor!, tenant, "shipment.read", shipment);
      await authorize(
        db,
        request.actor!,
        tenant,
        "document.download",
        shipment,
      );
      const row = (
        await db.query(
          `SELECT j.document_type,j.shipment_version,j.status,f.bytes,f.sha256,f.object_key,f.object_bucket,f.object_version,f.byte_size FROM document_jobs j LEFT JOIN document_files f ON f.job_id=j.id WHERE j.id=$1 AND j.tenant_id=$2 AND j.shipment_id=$3`,
          [id, tenant, shipment],
        )
      ).rows[0];
      assert(row, 404, "Document not found.");
      assert(
        row.status === "ready" && (row.bytes || row.object_key),
        409,
        "This document is not ready to download.",
      );
      // Read outside the DB transaction so slow storage cannot occupy a DB connection.
      return { ...row, tenant, shipment, id };
    });
    const bytes = await storage.read(result);
    // Session revocation and permission changes during object retrieval must block delivery.
    await transaction(pool, request.actor!.id, async (db) => {
      await authorize(
        db,
        request.actor!,
        result.tenant,
        "shipment.read",
        result.shipment,
      );
      await authorize(
        db,
        request.actor!,
        result.tenant,
        "document.download",
        result.shipment,
      );
      assert(
        (
          await db.query(
            "SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now() AND last_seen_at>now()-($2::integer*interval '1 second')",
            [request.actor!.sessionHash, config.SESSION_IDLE_SECONDS],
          )
        ).rowCount,
        401,
        "Your session ended. Sign in again.",
      );
      await audit(
        db,
        request.actor!.id,
        result.tenant,
        "document.saved_draft_downloaded",
        result.id,
        {
          shipmentId: result.shipment,
          shipmentVersion: result.shipment_version,
        },
      );
    });
    return reply
      .type("application/pdf")
      .header(
        "Content-Disposition",
        `attachment; filename="${result.document_type}-v${result.shipment_version}-draft.pdf"`,
      )
      .header("X-Document-SHA256", result.sha256)
      .send(bytes);
  });
}
