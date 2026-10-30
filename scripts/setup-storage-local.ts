// filepath: scripts/setup-storage-local.ts
import { Pool } from "pg";
import { parse } from "dotenv";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
const path = new URL("../.env", import.meta.url),
  raw = await readFile(path, "utf8"),
  env = parse(raw);
if (
  env.NODE_ENV !== "development" ||
  !["127.0.0.1", "localhost"].includes(new URL(env.DATABASE_URL).hostname)
)
  throw new Error("Storage setup is restricted to local development.");
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DB_SSL === "true" ? { rejectUnauthorized: true } : false,
  connectionTimeoutMillis: 3000,
});
try {
  const migration = await pool.query(
    "SELECT 1 FROM schema_migrations WHERE version='004_private_document_storage.sql'",
  );
  if (!migration.rowCount)
    throw new Error(
      "Run npm run db:migrate before configuring object storage.",
    );
} finally {
  await pool.end();
}
const defaults = {
  S3_BUCKET: "freightnaut-local-documents",
  S3_REGION: "us-east-1",
  S3_ENDPOINT: "http://127.0.0.1:8333",
  S3_FORCE_PATH_STYLE: "true",
  S3_ACCESS_KEY_ID: randomBytes(16).toString("hex"),
  S3_SECRET_ACCESS_KEY: randomBytes(32).toString("hex"),
};
let updated = raw;
for (const [key, value] of Object.entries(defaults))
  if (!env[key]) {
    env[key] = value;
    updated += "\n" + key + "=" + value;
  }
const endpoint = new URL(env.S3_ENDPOINT);
if (
  !["127.0.0.1", "localhost"].includes(endpoint.hostname) ||
  env.S3_FORCE_PATH_STYLE !== "true"
)
  throw new Error(
    "Local setup requires the loopback S3 service and path-style access.",
  );
await writeFile(path, updated.trimEnd() + "\n", { mode: 0o600 });
const docker = spawnSync("docker", ["compose", "up", "-d", "storage"], {
  cwd: new URL("../", import.meta.url),
  stdio: "inherit",
});
if (docker.status !== 0)
  throw new Error(
    "Local object storage did not start. Existing data and storage mode were preserved.",
  );
const client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  maxAttempts: 1,
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), {
        abortSignal: AbortSignal.timeout(1000),
      });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready)
    throw new Error(
      "Object storage is not ready. Existing documents and storage mode were preserved.",
    );
  const anonymous = await fetch(
    env.S3_ENDPOINT + "/" + encodeURIComponent(env.S3_BUCKET),
    { signal: AbortSignal.timeout(3000) },
  );
  if (anonymous.status !== 403)
    throw new Error(
      "Anonymous bucket access was not denied. Storage mode was not changed.",
    );
  updated = updated.replace(/^DOCUMENT_STORAGE=.*\n?/gm, "");
  await writeFile(path, updated.trimEnd() + "\nDOCUMENT_STORAGE=s3\n", {
    mode: 0o600,
  });
  console.log(
    "Private local object storage is ready. New PDFs use S3; existing Postgres files are retained. Restart API and worker to load the environment.",
  );
} finally {
  client.destroy();
}
