import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  roleTemplates,
  permissionCeilings,
  resolveSettings,
  defaultSettings,
  type Permission,
  type TenantKind,
  type SessionContext,
  type SettingsView,
  type SettingsLayer,
} from "@freightnaut/domain";
import type { Actor } from "../auth/session.js";
import { assert } from "../errors.js";
export const uuidSchema = z.uuid();
export function uuid(value: string) {
  return uuidSchema.parse(value);
}
export async function permissionsFor(
  db: Pool | PoolClient,
  actor: Actor,
  tenantId: string,
): Promise<Permission[]> {
  const result = await db.query(
    `SELECT r.permissions FROM memberships m JOIN roles r ON r.id=m.role_id AND r.tenant_id=m.tenant_id
 JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id
 WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now()) AND t.status='active' AND NOT u.disabled
 AND (t.parent_id IS NULL OR EXISTS(SELECT 1 FROM tenants p WHERE p.id=t.parent_id AND p.status='active'))`,
    [actor.id, tenantId],
  );
  return result.rows[0]?.permissions ?? [];
}
export async function authorize(
  db: Pool | PoolClient,
  actor: Actor,
  tenantId: string,
  permission: Permission,
  shipmentId?: string,
) {
  const permissions = await permissionsFor(db, actor, tenantId);
  if (permissions.includes(permission)) return;
  if (shipmentId) {
    const result = await db.query(
      `SELECT 1 FROM shipment_grants g JOIN tenants t ON t.id=g.tenant_id
 JOIN users u ON u.id=g.user_id WHERE g.user_id=$1 AND g.tenant_id=$2 AND g.shipment_id=$3 AND g.revoked_at IS NULL AND g.expires_at>now()
 AND $4=ANY(g.permissions) AND t.status='active' AND NOT u.disabled AND EXISTS(SELECT 1 FROM tenants p WHERE p.id=t.parent_id AND p.status='active')`,
      [actor.id, tenantId, shipmentId, permission],
    );
    if (result.rowCount) return;
  }
  assert(
    false,
    403,
    "You do not have permission for this workspace or action.",
  );
}
export async function contextFor(
  db: Pool,
  actor: Actor,
): Promise<SessionContext> {
  const rows = await db.query(
    `SELECT t.id,t.name,t.kind,t.parent_id,t.revision,r.id AS role_id,r.name AS role_name,r.permissions FROM memberships m
 JOIN tenants t ON t.id=m.tenant_id JOIN roles r ON r.id=m.role_id AND r.tenant_id=m.tenant_id
 WHERE m.user_id=$1 AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now()) AND t.status='active'
 AND (t.parent_id IS NULL OR EXISTS(SELECT 1 FROM tenants p WHERE p.id=t.parent_id AND p.status='active')) ORDER BY t.kind DESC,t.name`,
    [actor.id],
  );
  const shared = await db.query(
    `SELECT g.shipment_id,g.tenant_id,t.name,g.expires_at,g.permissions FROM shipment_grants g JOIN tenants t ON t.id=g.tenant_id
 WHERE g.user_id=$1 AND g.revoked_at IS NULL AND g.expires_at>now() AND t.status='active' AND EXISTS(SELECT 1 FROM tenants p WHERE p.id=t.parent_id AND p.status='active')`,
    [actor.id],
  );
  return {
    user: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      issuer: actor.issuer,
      subject: actor.subject,
    },
    csrfToken: actor.csrfToken,
    mfa: actor.mfa,
    operator: actor.operator,
    tenants: rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      parentId: r.parent_id,
      revision: r.revision,
      roleId: r.role_id,
      roleName: r.role_name,
      permissions: r.permissions,
    })),
    sharedShipments: shared.rows.map((r) => ({
      id: r.shipment_id,
      tenantId: r.tenant_id,
      name: r.name,
      expiresAt: r.expires_at.toISOString(),
      permissions: r.permissions,
    })),
  };
}
export async function createTenant(
  db: PoolClient,
  kind: TenantKind,
  name: string,
  parentId: string | null,
  ownerId: string | null,
) {
  const result = await db.query(
    "INSERT INTO tenants(kind,name,parent_id) VALUES($1,$2,$3) RETURNING *",
    [kind, name, parentId],
  );
  const tenant = result.rows[0];
  let ownerRole = "";
  for (const template of roleTemplates[kind]) {
    const role = await db.query(
      "INSERT INTO roles(tenant_id,key,name,permissions,reserved) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [
        tenant.id,
        template.key,
        template.name,
        template.permissions,
        !!template.reserved,
      ],
    );
    if (template.key === "owner") ownerRole = role.rows[0].id;
  }
  if (ownerId)
    await db.query(
      "INSERT INTO memberships(user_id,tenant_id,role_id) VALUES($1,$2,$3)",
      [ownerId, tenant.id, ownerRole],
    );
  return tenant;
}
export async function settingsFor(
  db: Pool | PoolClient,
  tenantId: string,
): Promise<SettingsView> {
  const result = await db.query("SELECT * FROM tenants WHERE id=$1", [
    tenantId,
  ]);
  const tenant = result.rows[0];
  assert(tenant, 404, "Workspace not found.");
  const layers: SettingsLayer[] = [
    { level: "base", values: defaultSettings, locks: [] },
  ];
  if (tenant.parent_id) {
    const parent = await db.query(
      "SELECT settings,locks FROM tenants WHERE id=$1",
      [tenant.parent_id],
    );
    layers.push({
      level: "partner",
      values: parent.rows[0].settings,
      locks: parent.rows[0].locks,
    });
  }
  layers.push({
    level: tenant.kind,
    values: tenant.settings,
    locks: tenant.locks,
  });
  const resolved = resolveSettings(layers);
  return {
    ...resolved,
    inheritedValues: resolveSettings(layers.slice(0, -1)).values,
    overrides: tenant.settings,
    locks: tenant.locks,
    revision: tenant.revision,
  };
}
