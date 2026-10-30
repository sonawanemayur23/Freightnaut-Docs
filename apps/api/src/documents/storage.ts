// filepath: apps/api/src/documents/storage.ts
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";
import { HttpError } from "../errors.js";
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export const MAX_PDF_BYTES = 10485760;
export interface StoredFile {
  bytes: Buffer | null;
  sha256: string;
  object_key: string | null;
  object_bucket: string | null;
  object_version: string | null;
  byte_size: number | null;
}
export class DocumentStorage {
  private s3: S3Client;
  constructor(private config: AppConfig) {
    this.s3 = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE === "true",
      credentials: config.S3_ACCESS_KEY_ID
        ? {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          }
        : undefined,
      maxAttempts: 2,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 2000,
        socketTimeout: 8000,
        requestTimeout: 10000,
      }),
    });
  }
  async save(
    tenant: string,
    job: string,
    token: string,
    bytes: Buffer,
  ): Promise<StoredFile> {
    const sha256 = hash(bytes);
    if (
      bytes.length < 5 ||
      bytes.length > MAX_PDF_BYTES ||
      bytes.subarray(0, 5).toString() !== "%PDF-"
    )
      throw new Error("Invalid PDF artifact");
    if (this.config.DOCUMENT_STORAGE === "postgres")
      return {
        bytes,
        sha256,
        object_key: null,
        object_bucket: null,
        object_version: null,
        byte_size: bytes.length,
      };
    // Each fenced attempt has its own immutable key. Failed database commits can leave private orphan objects; never delete them on an uncertain commit.
    const key = `drafts/${tenant}/${job}/${token}-${sha256}.pdf`,
      bucket = this.config.S3_BUCKET!;
    try {
      const result = await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: "application/pdf",
          ContentLength: bytes.length,
          IfNoneMatch: "*",
          Metadata: { sha256 },
          ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
          ...(this.config.NODE_ENV === "production"
            ? { ServerSideEncryption: "AES256" as const }
            : {}),
        }),
        { abortSignal: AbortSignal.timeout(12000) },
      );
      return {
        bytes: null,
        sha256,
        object_key: key,
        object_bucket: bucket,
        object_version: result.VersionId ?? null,
        byte_size: bytes.length,
      };
    } catch (error) {
      // A network retry may reach a PUT that already committed. Reuse only an identical private object.
      const code = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (code === 412) {
        const file: StoredFile = {
          bytes: null,
          sha256,
          object_key: key,
          object_bucket: bucket,
          object_version: null,
          byte_size: bytes.length,
        };
        const existing = await this.load(file);
        return { ...file, object_version: existing.version };
      }
      throw new HttpError(
        503,
        "Document storage is temporarily unavailable. Please retry shortly.",
      );
    }
  }
  async read(file: StoredFile): Promise<Buffer> {
    return (await this.load(file)).bytes;
  }
  private async load(
    file: StoredFile,
  ): Promise<{ bytes: Buffer; version: string | null }> {
    if (file.bytes) {
      this.verify(file.bytes, file);
      return { bytes: file.bytes, version: null };
    }
    if (!file.object_key || !file.object_bucket)
      throw new HttpError(409, "This document has no saved file.");
    let bytes: Buffer;
    let version: string | null = null;
    try {
      const result = await this.s3.send(
        new GetObjectCommand({
          Bucket: file.object_bucket,
          Key: file.object_key,
          ...(file.object_version ? { VersionId: file.object_version } : {}),
        }),
        { abortSignal: AbortSignal.timeout(12000) },
      );
      version = result.VersionId ?? null;
      const body = result.Body;
      if (!(body instanceof Readable))
        throw new Error("Unsupported object stream");
      if (
        !result.ContentLength ||
        result.ContentLength > MAX_PDF_BYTES ||
        result.ContentLength !== file.byte_size
      ) {
        body.destroy();
        throw new Error("Invalid object size");
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > MAX_PDF_BYTES) {
          body.destroy();
          throw new Error("Oversized PDF");
        }
        chunks.push(Buffer.from(chunk));
      }
      bytes = Buffer.concat(chunks);
    } catch {
      throw new HttpError(
        503,
        "The saved document is temporarily unavailable. Please retry shortly.",
      );
    }
    this.verify(bytes, file);
    return { bytes, version };
  }
  private verify(bytes: Buffer, file: StoredFile) {
    if (
      bytes.length < 5 ||
      bytes.length > MAX_PDF_BYTES ||
      (file.byte_size !== null && file.byte_size !== bytes.length) ||
      bytes.subarray(0, 5).toString() !== "%PDF-" ||
      hash(bytes) !== file.sha256
    )
      throw new HttpError(500, "The saved document could not be verified.");
  }
  close() {
    this.s3.destroy();
  }
}
