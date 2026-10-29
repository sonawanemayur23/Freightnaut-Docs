import type { PoolClient } from "pg";
import { randomToken, tokenHash, type Actor } from "../auth/session.js";
import type { AppConfig } from "../config.js";
import { audit } from "../audit.js";
export async function makeInvitation(
  db: PoolClient,
  actor: Actor,
  config: AppConfig,
  input: {
    tenantId: string;
    authorityTenantId?: string | null;
    email: string;
    roleId?: string;
    shipmentId?: string;
    permissions?: string[];
  },
) {
  const token = randomToken();
  const result = await db.query(
    `INSERT INTO invitations(tenant_id,authority_tenant_id,email,token_hash,role_id,shipment_id,permissions,created_by,expires_at,issuer)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+($9::integer * interval '1 hour'),$10) RETURNING id,expires_at`,
    [
      input.tenantId,
      input.authorityTenantId === undefined
        ? input.tenantId
        : input.authorityTenantId,
      input.email.toLowerCase(),
      tokenHash(token),
      input.roleId ?? null,
      input.shipmentId ?? null,
      input.permissions ?? [],
      actor.id,
      config.INVITATION_TTL_HOURS,
      actor.issuer,
    ],
  );
  await audit(
    db,
    actor.id,
    input.authorityTenantId ?? input.tenantId,
    "invitation.created",
    result.rows[0].id,
    { scope: input.shipmentId ? "shipment" : "workspace" },
  );
  return {
    id: result.rows[0].id,
    expiresAt: result.rows[0].expires_at,
    inviteUrl: config.PUBLIC_ORIGIN + "/invite#token=" + token,
  };
}
