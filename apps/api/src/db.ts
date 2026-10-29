import { Pool, type PoolClient } from "pg";
import type { AppConfig } from "./config.js";
export function createPool(config: AppConfig) {
  return new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DB_SSL === "true" ? { rejectUnauthorized: true } : false,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  });
}
export async function transaction<T>(
  pool: Pool,
  userId: string | null,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [
      userId ?? "",
    ]);
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function assertRuntimeRole(pool: Pool) {
  const result = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  if (result.rows[0]?.rolsuper || result.rows[0]?.rolbypassrls)
    throw new Error("Runtime database user must not be superuser or BYPASSRLS");
  const required = [
    "001_identity_tenancy.sql",
    "002_invitation_identity_binding.sql",
    "003_document_jobs.sql",
  ];
  const migrations = await pool.query(
    "SELECT version FROM schema_migrations WHERE version=ANY($1)",
    [required],
  );
  if (migrations.rowCount !== required.length)
    throw new Error(
      "Database migrations are incomplete. Run db:migrate with the migration role.",
    );
}
