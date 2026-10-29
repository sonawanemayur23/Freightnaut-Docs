import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { transaction } from "../db.js";
import { assert, created } from "../errors.js";
import { audit } from "../audit.js";
import { createTenant } from "./service.js";
export function registerOnboarding(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
) {
  app.post("/api/onboarding/workspace", async (request, reply) => {
    assert(
      config.LOCAL_SELF_SERVICE_SIGNUP === "true",
      403,
      "Workspace signup is not enabled. Accept your workspace invitation.",
    );
    const input = z
      .strictObject({ companyName: z.string().trim().min(1).max(200) })
      .parse(request.body);
    const actor = request.actor!;
    return transaction(pool, actor.id, async (db) => {
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actor.id]);
      assert(
        !(
          await db.query("SELECT 1 FROM memberships WHERE user_id=$1 LIMIT 1", [
            actor.id,
          ])
        ).rowCount,
        409,
        "Your workspace already exists. Refresh to continue.",
      );
      const partner = await createTenant(
        db,
        "partner",
        input.companyName,
        null,
        actor.id,
      );
      const account = await createTenant(
        db,
        "account",
        input.companyName,
        partner.id,
        actor.id,
      );
      await audit(db, actor.id, partner.id, "workspace.created", partner.id, {
        source: "local-self-service",
      });
      await audit(db, actor.id, account.id, "workspace.created", account.id, {
        source: "local-self-service",
      });
      return created(reply, { workspaceId: account.id });
    });
  });
}
