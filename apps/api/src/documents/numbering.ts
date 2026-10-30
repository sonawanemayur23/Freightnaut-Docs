// filepath: apps/api/src/documents/numbering.ts
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  seriesSchema,
  reserveNumberSchema,
  voidNumberSchema,
  numberingPeriod,
  formatDocumentNumber,
  shipmentSchema,
  validateShipment,
} from "@freightnaut/domain";
import { transaction } from "../db.js";
import {
  authorize,
  permissionsFor,
  settingsFor,
  uuid,
} from "../tenancy/service.js";
import { requireMfa } from "../auth/session.js";
import type { AppConfig } from "../config.js";
import { assert } from "../errors.js";
import { audit } from "../audit.js";
const reservations = `id,document_type AS "documentType",number,branch,sequence::integer,status,created_at AS "createdAt",void_reason AS "voidReason",config_snapshot->>'name' AS "seriesName",series_revision AS "seriesRevision"`;
async function lockSeries(db: PoolClient, id: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "document-number-series:" + id,
  ]);
}
export function registerNumbering(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
) {
  type Params = {
    tenantId: string;
    seriesId: string;
    shipmentId: string;
    reservationId: string;
  };
  const root = "/api/tenants/:tenantId/number-series",
    shipmentRoot =
      "/api/tenants/:tenantId/shipments/:shipmentId/number-reservations";
  app.get<{ Params: Params }>(root, async (request) =>
    transaction(pool, request.actor!.id, async (db) => {
      const tenant = uuid(request.params.tenantId),
        actor = request.actor!,
        permissions = await permissionsFor(db, actor, tenant);
      assert(
        permissions.includes("tenant.settings.write") ||
          permissions.includes("document.number.reserve"),
        403,
        "Numbering access is required.",
      );
      assert(
        (
          await db.query(
            "SELECT 1 FROM tenants WHERE id=$1 AND kind='account'",
            [tenant],
          )
        ).rowCount,
        400,
        "Numbering belongs to customer accounts.",
      );
      const timeZone = (await settingsFor(db, tenant)).values.timeZone,
        now = new Date();
      const rows = await db.query(
        "SELECT id,revision,config FROM number_series WHERE tenant_id=$1 ORDER BY updated_at DESC,id",
        [tenant],
      );
      const series = [];
      for (const row of rows.rows) {
        const seriesConfig = seriesSchema.parse(row.config),
          { period } = numberingPeriod(seriesConfig, now, timeZone),
          counters = (
            await db.query(
              "SELECT branch_scope,next_value FROM number_counters WHERE series_id=$1 AND period=$2",
              [row.id, period],
            )
          ).rows;
        series.push({
          ...row,
          next: seriesConfig.branches.map((branch) => {
            const scope = seriesConfig.separateByBranch ? branch.code : "*",
              sequence = Number(
                counters.find((counter) => counter.branch_scope === scope)
                  ?.next_value ?? seriesConfig.startsAt,
              );
            return {
              branch: branch.code,
              sequence,
              period,
              number: formatDocumentNumber(
                seriesConfig,
                branch.code,
                sequence,
                now,
                timeZone,
              ),
            };
          }),
        });
      }
      return { series };
    }),
  );
  app.post<{ Params: Params }>(root, async (request, reply) => {
    const tenant = uuid(request.params.tenantId),
      input = seriesSchema.parse(request.body),
      actor = request.actor!;
    requireMfa(actor, config);
    const series = await transaction(pool, actor.id, async (db) => {
      await authorize(db, actor, tenant, "tenant.settings.write");
      assert(
        (
          await db.query(
            "SELECT id FROM tenants WHERE id=$1 AND kind='account' FOR UPDATE",
            [tenant],
          )
        ).rowCount,
        400,
        "Numbering belongs to customer accounts.",
      );
      assert(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM number_series WHERE tenant_id=$1",
            [tenant],
          )
        ).rows[0].n < 50,
        409,
        "This account already has 50 number series. Edit an existing series.",
      );
      const row = (
        await db.query(
          "INSERT INTO number_series(tenant_id,document_type,config,changed_by) VALUES($1,$2,$3,$4) RETURNING id,revision,config",
          [tenant, input.documentType, JSON.stringify(input), actor.id],
        )
      ).rows[0];
      await audit(db, actor.id, tenant, "numbering.series_created", row.id, {
        documentType: input.documentType,
      });
      return row;
    });
    return reply.code(201).send(series);
  });
  app.put<{ Params: Params }>(root + "/:seriesId", async (request) => {
    const tenant = uuid(request.params.tenantId),
      id = uuid(request.params.seriesId),
      input = z
        .strictObject({
          revision: z.number().int().positive(),
          config: seriesSchema,
        })
        .parse(request.body),
      actor = request.actor!;
    requireMfa(actor, config);
    return transaction(pool, actor.id, async (db) => {
      await authorize(db, actor, tenant, "tenant.settings.write");
      await lockSeries(db, id);
      const existing = (
        await db.query(
          "SELECT document_type FROM number_series WHERE id=$1 AND tenant_id=$2",
          [id, tenant],
        )
      ).rows[0];
      assert(existing, 404, "Series not found.");
      assert(
        existing.document_type === input.config.documentType,
        409,
        "Create a new series to change the document type.",
      );
      const row = (
        await db.query(
          "UPDATE number_series SET config=$3,revision=revision+1,changed_by=$4,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND revision=$5 RETURNING id,revision,config",
          [id, tenant, JSON.stringify(input.config), actor.id, input.revision],
        )
      ).rows[0];
      assert(row, 409, "This series changed. Reload before saving.");
      await audit(db, actor.id, tenant, "numbering.series_updated", id, {
        revision: row.revision,
      });
      return row;
    });
  });
  app.get<{ Params: Params }>(shipmentRoot, async (request) =>
    transaction(pool, request.actor!.id, async (db) => {
      const tenant = uuid(request.params.tenantId),
        shipment = uuid(request.params.shipmentId);
      await authorize(db, request.actor!, tenant, "shipment.read", shipment);
      return {
        reservations: (
          await db.query(
            `SELECT ${reservations} FROM number_reservations WHERE tenant_id=$1 AND shipment_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100`,
            [tenant, shipment],
          )
        ).rows,
      };
    }),
  );
  app.post<{ Params: Params }>(
    shipmentRoot,
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const tenant = uuid(request.params.tenantId),
        shipment = uuid(request.params.shipmentId),
        actor = request.actor!,
        input = reserveNumberSchema.parse(request.body);
      requireMfa(actor, config);
      const result = await transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenant, "document.number.reserve");
        await authorize(db, actor, tenant, "shipment.write");
        await authorize(db, actor, tenant, "shipment.read", shipment);
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          actor.id,
        ]);
        const prior = (
          await db.query(
            `SELECT ${reservations},shipment_id,series_id FROM number_reservations WHERE tenant_id=$1 AND requested_by=$2 AND idempotency_key=$3`,
            [tenant, actor.id, input.idempotencyKey],
          )
        ).rows[0];
        if (prior) {
          assert(
            prior.shipment_id === shipment &&
              prior.series_id === input.seriesId &&
              prior.branch === input.branch,
            409,
            "This request key was already used for another number.",
          );
          return prior;
        }
        const source = (
          await db.query(
            "SELECT data,version FROM shipments WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
            [shipment, tenant],
          )
        ).rows[0];
        assert(source, 404, "Shipment not found.");
        assert(
          source.version === input.version,
          409,
          "The shipment changed. Reload before reserving a number.",
        );
        await lockSeries(db, input.seriesId);
        const series = (
          await db.query(
            "SELECT config,revision,document_type FROM number_series WHERE id=$1 AND tenant_id=$2",
            [input.seriesId, tenant],
          )
        ).rows[0];
        assert(series, 404, "Series not found.");
        const active = (
          await db.query(
            `SELECT ${reservations},series_id FROM number_reservations WHERE tenant_id=$1 AND shipment_id=$2 AND document_type=$3 AND status='reserved'`,
            [tenant, shipment, series.document_type],
          )
        ).rows[0];
        if (active) {
          assert(
            active.series_id === input.seriesId &&
              active.branch === input.branch,
            409,
            "Void the current reservation before choosing another series or branch.",
          );
          return active;
        }
        const seriesConfig = seriesSchema.parse(series.config);
        assert(seriesConfig.active, 409, "This series is inactive.");
        assert(
          series.revision === input.seriesRevision,
          409,
          "The numbering settings changed. Refresh before reserving.",
        );
        assert(
          seriesConfig.branches.some((branch) => branch.code === input.branch),
          400,
          "Choose a configured branch.",
        );
        const settings = (await settingsFor(db, tenant)).values;
        assert(
          !validateShipment(shipmentSchema.parse(source.data), settings).some(
            (issue) => issue.severity === "blocker",
          ),
          409,
          "Complete the required shipment details before reserving a number.",
        );
        const now = new Date(),
          { period } = numberingPeriod(seriesConfig, now, settings.timeZone),
          scope = seriesConfig.separateByBranch ? input.branch : "*";
        const existing = (
          await db.query(
            "SELECT next_value FROM number_counters WHERE series_id=$1 AND branch_scope=$2 AND period=$3",
            [input.seriesId, scope, period],
          )
        ).rows[0];
        const sequence = Number(existing?.next_value ?? seriesConfig.startsAt);
        assert(
          sequence <= 999999999,
          409,
          "This number series is exhausted. Configure a new series.",
        );
        const number = formatDocumentNumber(
          seriesConfig,
          input.branch,
          sequence,
          now,
          settings.timeZone,
        );
        assert(
          !(
            await db.query(
              "SELECT 1 FROM number_reservations WHERE tenant_id=$1 AND document_type=$2 AND number=$3",
              [tenant, series.document_type, number],
            )
          ).rowCount,
          409,
          "This pattern overlaps an already reserved number. Update the series pattern; no number was consumed.",
        );
        await db.query(
          "INSERT INTO number_counters(series_id,tenant_id,branch_scope,period,next_value) VALUES($1,$2,$3,$4,$5) ON CONFLICT(series_id,branch_scope,period) DO UPDATE SET next_value=number_counters.next_value+1",
          [input.seriesId, tenant, scope, period, sequence + 1],
        );
        const row = (
          await db.query(
            `INSERT INTO number_reservations(tenant_id,shipment_id,series_id,document_type,number,branch,sequence,period,series_revision,config_snapshot,requested_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${reservations}`,
            [
              tenant,
              shipment,
              input.seriesId,
              series.document_type,
              number,
              input.branch,
              sequence,
              period,
              series.revision,
              JSON.stringify(seriesConfig),
              actor.id,
              input.idempotencyKey,
            ],
          )
        ).rows[0];
        await audit(db, actor.id, tenant, "numbering.reserved", row.id, {
          shipmentId: shipment,
          number,
          seriesId: input.seriesId,
          branch: input.branch,
        });
        return row;
      });
      return reply.code(201).send(result);
    },
  );
  app.post<{ Params: Params }>(
    shipmentRoot + "/:reservationId/void",
    async (request) => {
      const tenant = uuid(request.params.tenantId),
        shipment = uuid(request.params.shipmentId),
        id = uuid(request.params.reservationId),
        input = voidNumberSchema.parse(request.body),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenant, "document.number.reserve");
        await authorize(db, actor, tenant, "shipment.write");
        assert(
          (
            await db.query(
              "SELECT id FROM shipments WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
              [shipment, tenant],
            )
          ).rowCount,
          404,
          "Shipment not found.",
        );
        const row = (
          await db.query(
            `SELECT ${reservations} FROM number_reservations WHERE id=$1 AND tenant_id=$2 AND shipment_id=$3 FOR UPDATE`,
            [id, tenant, shipment],
          )
        ).rows[0];
        assert(row, 404, "Reservation not found.");
        if (row.status === "voided") {
          assert(
            row.voidReason === input.reason,
            409,
            "This reservation was already voided with a different reason.",
          );
          return row;
        }
        const result = (
          await db.query(
            `UPDATE number_reservations SET status='voided',void_reason=$2,voided_by=$3,voided_at=now() WHERE id=$1 RETURNING ${reservations}`,
            [id, input.reason, actor.id],
          )
        ).rows[0];
        await audit(db, actor.id, tenant, "numbering.voided", id, {
          shipmentId: shipment,
          number: row.number,
          reason: input.reason,
        });
        return result;
      });
    },
  );
}
