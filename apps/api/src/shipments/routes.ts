import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  shipmentSchema,
  renderDocument,
  validateShipment,
  totalAmount,
  createBlankShipment,
} from "@freightnaut/domain";
import { transaction } from "../db.js";
import { authorize, settingsFor, uuid } from "../tenancy/service.js";
import { audit } from "../audit.js";
import { assert, created } from "../errors.js";
import { requireMfa } from "../auth/session.js";
import { makeInvitation } from "../tenancy/invitations.js";
import type { AppConfig } from "../config.js";
import { PdfRenderer } from "../documents/renderer.js";
export function registerShipments(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
) {
  const renderer = new PdfRenderer(config);
  app.get<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/shipments",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        actor = request.actor!;
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(25),
          q: z.string().trim().max(200).default(""),
          recent: z.enum(["true", "false"]).default("false"),
          cursor: z.string().max(512).optional(),
          before: z.iso.datetime().optional(),
        })
        .parse(request.query);
      let cursor: { at: string; id: string } | null = null;
      if (query.cursor) {
        try {
          cursor = z
            .object({ at: z.iso.datetime({ offset: true }), id: z.uuid() })
            .parse(
              JSON.parse(
                Buffer.from(query.cursor, "base64url").toString("utf8"),
              ),
            );
        } catch {
          assert(
            false,
            400,
            "The shipment page expired. Return to the first page.",
          );
        }
      }
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "shipment.read");
        const settings = (await settingsFor(db, tenantId)).values;
        const search = "%" + query.q.replace(/[\\%_]/g, "\\$&") + "%";
        const counts = (
          await db.query(
            `SELECT count(*)::int AS total,count(*) FILTER(WHERE updated_at>=now()-interval '7 days')::int AS updated_recent,
 count(*) FILTER(WHERE (data->>'id' ILIKE $2 OR data->'consignee'->>'name' ILIKE $2) AND (NOT $3 OR updated_at>=now()-interval '7 days'))::int AS matched FROM shipments WHERE tenant_id=$1`,
            [tenantId, search, query.recent === "true"],
          )
        ).rows[0];
        const result = await db.query(
          `SELECT id,data,version,updated_at,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM shipments WHERE tenant_id=$1
 AND (data->>'id' ILIKE $2 OR data->'consignee'->>'name' ILIKE $2)
 AND (NOT $3 OR updated_at>=now()-interval '7 days')
 AND ($4::timestamptz IS NULL OR (updated_at,id)<($4::timestamptz,$5::uuid))
 AND ($6::timestamptz IS NULL OR updated_at<$6::timestamptz)
 ORDER BY updated_at DESC,id DESC LIMIT $7`,
          [
            tenantId,
            search,
            query.recent === "true",
            cursor?.at ?? null,
            cursor?.id ?? null,
            query.before ?? null,
            query.limit + 1,
          ],
        );
        const hasMore = result.rows.length > query.limit,
          visible = result.rows.slice(0, query.limit),
          last = visible.at(-1);
        return {
          total: counts.total,
          updatedRecent: counts.updated_recent,
          matched: counts.matched,
          nextCursor:
            hasMore && last
              ? Buffer.from(
                  JSON.stringify({ at: last.cursor_time, id: last.id }),
                ).toString("base64url")
              : null,
          shipments: visible.map((row) => {
            const data = shipmentSchema.parse(row.data);
            return {
              id: row.id,
              reference: data.id,
              consignee: data.consignee.name,
              version: row.version,
              updated_at: row.updated_at,
              originCountry: data.originCountry,
              destinationCountry: data.destinationCountry,
              currency: data.currency,
              value: totalAmount(data),
              itemCount: data.items.length,
              blockerCount: validateShipment(data, settings).filter(
                (issue) => issue.severity === "blocker",
              ).length,
            };
          }),
        };
      });
    },
  );
  app.post<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/shipments",
    async (request, reply) => {
      const tenantId = uuid(request.params.tenantId),
        data = shipmentSchema.parse(request.body),
        actor = request.actor!;
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "shipment.write");
        assert(
          (
            await db.query(
              "SELECT 1 FROM tenants WHERE id=$1 AND kind='account'",
              [tenantId],
            )
          ).rowCount,
          400,
          "Shipments belong to customer accounts.",
        );
        const result = await db.query(
          "INSERT INTO shipments(tenant_id,data,created_by,updated_by) VALUES($1,$2,$3,$3) RETURNING id,version,data,updated_at",
          [tenantId, JSON.stringify(data), actor.id],
        );
        await audit(
          db,
          actor.id,
          tenantId,
          "shipment.created",
          result.rows[0].id,
        );
        return created(reply, result.rows[0]);
      });
    },
  );
  app.post<{ Params: { tenantId: string; shipmentId: string } }>(
    "/api/tenants/:tenantId/shipments/:shipmentId/copy",
    async (request, reply) => {
      const tenantId = uuid(request.params.tenantId),
        id = uuid(request.params.shipmentId),
        actor = request.actor!;
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "shipment.write");
        await authorize(db, actor, tenantId, "shipment.read", id);
        const original = (
          await db.query(
            "SELECT data FROM shipments WHERE id=$1 AND tenant_id=$2",
            [id, tenantId],
          )
        ).rows[0];
        assert(original, 404, "Shipment not found.");
        const settings = (await settingsFor(db, tenantId)).values,
          source = shipmentSchema.parse(original.data);
        const data = {
          ...source,
          id: "",
          date: createBlankShipment(settings).date,
          items: source.items.map((item) => ({
            ...item,
            id: crypto.randomUUID(),
          })),
        };
        const row = (
          await db.query(
            "INSERT INTO shipments(tenant_id,data,created_by,updated_by) VALUES($1,$2,$3,$3) RETURNING id,version,data,updated_at",
            [tenantId, JSON.stringify(data), actor.id],
          )
        ).rows[0];
        await audit(db, actor.id, tenantId, "shipment.copied", row.id, {
          sourceId: id,
        });
        return created(reply, row);
      });
    },
  );
  app.get<{ Params: { tenantId: string; shipmentId: string } }>(
    "/api/tenants/:tenantId/shipments/:shipmentId",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        id = uuid(request.params.shipmentId),
        actor = request.actor!;
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "shipment.read", id);
        const row = (
          await db.query(
            "SELECT id,version,data,updated_at FROM shipments WHERE id=$1 AND tenant_id=$2",
            [id, tenantId],
          )
        ).rows[0];
        assert(row, 404, "Shipment not found.");
        return {
          ...row,
          issues: validateShipment(
            row.data,
            (await settingsFor(db, tenantId)).values,
          ),
          settings: await settingsFor(db, tenantId),
        };
      });
    },
  );
  app.put<{ Params: { tenantId: string; shipmentId: string } }>(
    "/api/tenants/:tenantId/shipments/:shipmentId",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        id = uuid(request.params.shipmentId),
        input = z
          .strictObject({
            version: z.number().int().positive(),
            data: shipmentSchema,
          })
          .parse(request.body),
        actor = request.actor!;
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "shipment.write");
        const result = await db.query(
          "UPDATE shipments SET data=$3,version=version+1,updated_by=$4,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND version=$5 RETURNING id,version,data,updated_at",
          [id, tenantId, JSON.stringify(input.data), actor.id, input.version],
        );
        if (!result.rowCount) {
          const exists = await db.query(
            "SELECT 1 FROM shipments WHERE id=$1 AND tenant_id=$2",
            [id, tenantId],
          );
          assert(exists.rowCount, 404, "Shipment not found.");
          assert(
            false,
            409,
            "Someone else changed this shipment. Reload it before saving.",
          );
        }
        await audit(db, actor.id, tenantId, "shipment.updated", id, {
          version: result.rows[0].version,
        });
        return result.rows[0];
      });
    },
  );
  app.post<{ Params: { tenantId: string; shipmentId: string; type: string } }>(
    "/api/tenants/:tenantId/shipments/:shipmentId/documents/:type/pdf",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const tenantId = uuid(request.params.tenantId),
        id = uuid(request.params.shipmentId),
        type = z.enum(["invoice", "packing-list"]).parse(request.params.type),
        actor = request.actor!;
      const expectedVersion = z
        .strictObject({ version: z.number().int().positive() })
        .parse(request.body).version;
      const snapshot = await transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "document.download", id);
        await authorize(db, actor, tenantId, "shipment.read", id);
        const row = (
          await db.query(
            "SELECT data,version FROM shipments WHERE id=$1 AND tenant_id=$2",
            [id, tenantId],
          )
        ).rows[0];
        assert(row, 404, "Shipment not found.");
        assert(
          row.version === expectedVersion,
          409,
          "The shipment changed. Reload before downloading.",
        );
        return {
          data: shipmentSchema.parse(row.data),
          version: row.version,
          settings: (await settingsFor(db, tenantId)).values,
        };
      });
      const bytes = await renderer.render(
        renderDocument(snapshot.data, type, snapshot.settings),
      );
      // Revocation during rendering must prevent output delivery too.
      await transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "document.download", id);
        assert(
          (
            await db.query(
              "SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now()",
              [actor.sessionHash],
            )
          ).rowCount,
          401,
          "Your session ended. Sign in again.",
        );
        await audit(db, actor.id, tenantId, "document.draft_downloaded", id, {
          type,
          shipmentVersion: snapshot.version,
        });
      });
      return reply
        .type("application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${type}-draft.pdf"`,
        )
        .send(bytes);
    },
  );
  app.post<{ Params: { tenantId: string; shipmentId: string } }>(
    "/api/tenants/:tenantId/shipments/:shipmentId/collaborators",
    async (request, reply) => {
      const tenantId = uuid(request.params.tenantId),
        id = uuid(request.params.shipmentId),
        input = z
          .strictObject({
            email: z.email(),
            allowDownload: z.boolean().default(false),
          })
          .parse(request.body),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "tenant.members.manage");
        await authorize(db, actor, tenantId, "shipment.read");
        assert(
          (
            await db.query(
              "SELECT 1 FROM shipments WHERE id=$1 AND tenant_id=$2",
              [id, tenantId],
            )
          ).rowCount,
          404,
          "Shipment not found.",
        );
        if (input.allowDownload)
          await authorize(db, actor, tenantId, "document.download");
        return created(
          reply,
          await makeInvitation(db, actor, config, {
            tenantId,
            email: input.email,
            shipmentId: id,
            permissions: input.allowDownload
              ? ["shipment.read", "document.download"]
              : ["shipment.read"],
          }),
        );
      });
    },
  );
  app.delete<{
    Params: { tenantId: string; shipmentId: string; grantId: string };
  }>(
    "/api/tenants/:tenantId/shipments/:shipmentId/collaborators/:grantId",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        id = uuid(request.params.shipmentId),
        grantId = uuid(request.params.grantId),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "tenant.members.manage");
        await db.query(
          "UPDATE shipment_grants SET revoked_at=now() WHERE id=$1 AND shipment_id=$2 AND tenant_id=$3",
          [grantId, id, tenantId],
        );
        await audit(db, actor.id, tenantId, "collaborator.revoked", grantId);
        return { revoked: true };
      });
    },
  );
  app.get<{ Params: { tenantId: string; shipmentId: string } }>(
    "/api/tenants/:tenantId/shipments/:shipmentId/collaborators",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        id = uuid(request.params.shipmentId);
      await authorize(pool, request.actor!, tenantId, "tenant.members.manage");
      return {
        grants: (
          await pool.query(
            "SELECT g.id,g.user_id,g.permissions,g.expires_at,g.revoked_at,u.name,u.email FROM shipment_grants g JOIN users u ON u.id=g.user_id WHERE g.tenant_id=$1 AND g.shipment_id=$2 ORDER BY g.expires_at DESC LIMIT 100",
            [tenantId, id],
          )
        ).rows,
      };
    },
  );
}
