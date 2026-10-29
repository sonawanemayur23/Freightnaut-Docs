import "dotenv/config";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { z } from "zod";
import { createTenant } from "../apps/api/src/tenancy/service.js";
import { transaction } from "../apps/api/src/db.js";
import { audit } from "../apps/api/src/audit.js";
const args = parseArgs({
  options: {
    "user-id": { type: "string" },
    "partner-name": { type: "string" },
    "account-name": { type: "string" },
    operator: { type: "boolean", default: false },
  },
}).values;
const userId = z.uuid().parse(args["user-id"]);
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error(
    "MIGRATION_DATABASE_URL is required for offline provisioning.",
  );
const pool = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : false,
});
try {
  await transaction(pool, userId, async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('freightnaut-bootstrap'))",
    );
    const user = (
      await db.query(
        "SELECT id,email_verified,disabled FROM users WHERE id=$1",
        [userId],
      )
    ).rows[0];
    if (!user || !user.email_verified || user.disabled)
      throw new Error("Sign in first with a verified, active identity.");
    if (args.operator)
      await db.query(
        "INSERT INTO operators(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [userId],
      );
    if (args["partner-name"]) {
      const partner = await createTenant(
        db,
        "partner",
        z.string().trim().min(1).max(200).parse(args["partner-name"]),
        null,
        userId,
      );
      await audit(db, userId, partner.id, "workspace.bootstrapped", partner.id);
      console.log("Created partner", partner.id);
      if (args["account-name"]) {
        const account = await createTenant(
          db,
          "account",
          z.string().trim().min(1).max(200).parse(args["account-name"]),
          partner.id,
          userId,
        );
        await audit(
          db,
          userId,
          account.id,
          "workspace.bootstrapped",
          account.id,
        );
        console.log("Created account", account.id);
      }
    } else if (args["account-name"])
      throw new Error("--account-name requires --partner-name.");
    console.log("Provisioning completed for user", userId);
  });
} finally {
  await pool.end();
}
