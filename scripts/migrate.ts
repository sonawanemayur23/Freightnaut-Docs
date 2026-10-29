import "dotenv/config";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const role = process.env.APP_DATABASE_ROLE;
if (!role || !/^[_a-z][_a-z0-9]{0,62}$/.test(role))
  throw new Error("APP_DATABASE_ROLE must be a valid role name");
const pool = new Pool({
  connectionString: url,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : false,
});
const client = await pool.connect();
try {
  await client.query(
    "SELECT pg_advisory_lock(hashtext('freightnaut-migrations'))",
  );
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const directory = new URL("../apps/api/migrations/", import.meta.url);
  for (const file of (await readdir(directory))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (
      (
        await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
          file,
        ])
      ).rowCount
    )
      continue;
    await client.query("BEGIN");
    try {
      await client.query(await readFile(new URL(file, directory), "utf8"));
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
      await client.query("COMMIT");
      console.log("Applied", file);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
  // Metadata requires application authorization. Tenant documents additionally enforce RLS.
  await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await client.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON tenants,roles,memberships,sessions,login_transactions,shipment_grants,invitations TO "${role}"`,
  );
  await client.query(`REVOKE ALL ON operators,users FROM "${role}"`);
  await client.query(`GRANT SELECT ON operators TO "${role}"`);
  await client.query(`GRANT SELECT,INSERT ON users TO "${role}"`);
  await client.query(
    `GRANT UPDATE(email,email_verified,name) ON users TO "${role}"`,
  );
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await client.query(`GRANT SELECT,INSERT,UPDATE ON shipments TO "${role}"`);
  await client.query(
    `GRANT SELECT,INSERT ON audit_events,settings_versions TO "${role}"`,
  );
  await client.query(`GRANT SELECT ON schema_migrations TO "${role}"`);
  await client.query(
    "REVOKE ALL ON FUNCTION has_permission(uuid,text,uuid) FROM PUBLIC",
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION has_permission(uuid,text,uuid) TO "${role}"`,
  );
} finally {
  await client.query(
    "SELECT pg_advisory_unlock(hashtext('freightnaut-migrations'))",
  );
  client.release();
  await pool.end();
}
