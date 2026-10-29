import type { PoolClient } from "pg";
export async function audit(
  client: PoolClient,
  actorId: string,
  tenantId: string,
  action: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await client.query(
    "INSERT INTO audit_events(tenant_id,actor_id,action,resource_id,metadata) VALUES($1,$2,$3,$4,$5)",
    [tenantId, actorId, action, resourceId, JSON.stringify(metadata)],
  );
}
