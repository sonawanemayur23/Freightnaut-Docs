import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  roleInputSchema,
  validateRolePermissions,
  permissionCeilings,
  settingsPatchSchema,
  settingKeys,
  type SettingKey,
  type Permission,
  type TenantKind,
} from "@freightnaut/domain";
import { transaction } from "../db.js";
import { assert, created } from "../errors.js";
import { audit } from "../audit.js";
import { requireMfa, tokenHash, type Actor } from "../auth/session.js";
import type { AppConfig } from "../config.js";
import {
  authorize,
  permissionsFor,
  createTenant,
  settingsFor,
  uuid,
} from "./service.js";
import { makeInvitation } from "./invitations.js";
export function registerTenancy(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
) {
  const params = z.object({ tenantId: z.uuid() });
  app.get<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/settings",
    async (request) => {
      const { tenantId } = params.parse(request.params);
      const actor = request.actor!;
      const permissions = await permissionsFor(pool, actor, tenantId);
      assert(permissions.length, 403, "Workspace access is required.");
      return settingsFor(pool, tenantId);
    },
  );
  app.put<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/settings",
    async (request) => {
      const { tenantId } = params.parse(request.params);
      const input = z
        .strictObject({
          revision: z.number().int().positive(),
          overrides: settingsPatchSchema,
          locks: z.array(z.enum(settingKeys)).max(settingKeys.length),
        })
        .parse(request.body);
      const actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
          tenantId,
        ]);
        await authorize(db, actor, tenantId, "tenant.settings.write");
        const before = await settingsFor(db, tenantId);
        assert(
          before.revision === input.revision,
          409,
          "Settings changed. Reload before saving.",
        );
        for (const key of Object.keys(input.overrides) as SettingKey[]) {
          const lock = before.provenance[key].lockedBy;
          assert(
            !lock ||
              lock ===
                (
                  await db.query("SELECT kind FROM tenants WHERE id=$1", [
                    tenantId,
                  ])
                ).rows[0].kind,
            403,
            `Setting ${key} is locked by ${lock}.`,
          );
        }
        const revision = before.revision + 1;
        await db.query(
          "UPDATE tenants SET settings=$2,locks=$3,revision=$4 WHERE id=$1",
          [tenantId, JSON.stringify(input.overrides), input.locks, revision],
        );
        const after = await settingsFor(db, tenantId);
        for (const field of before.values.customFields) {
          const next = after.values.customFields.find(
            (item) => item.key === field.key,
          );
          assert(
            next,
            400,
            "Published field keys cannot be removed. Hide the field to preserve existing shipment data.",
          );
          assert(
            next.type === field.type,
            400,
            "Published field types cannot change. Create a new field and hide the old field instead.",
          );
        }
        await db.query(
          "INSERT INTO settings_versions(tenant_id,revision,settings,locks,changed_by) VALUES($1,$2,$3,$4,$5)",
          [
            tenantId,
            revision,
            JSON.stringify(input.overrides),
            input.locks,
            actor.id,
          ],
        );
        await audit(db, actor.id, tenantId, "settings.updated", tenantId, {
          revision,
          changedKeys: Object.keys(input.overrides),
          locks: input.locks,
        });
        return settingsFor(db, tenantId);
      });
    },
  );
  app.get<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/roles",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        actor = request.actor!;
      await authorize(pool, actor, tenantId, "tenant.members.manage");
      const tenant = (
        await pool.query("SELECT kind FROM tenants WHERE id=$1", [tenantId])
      ).rows[0];
      return {
        roles: (
          await pool.query(
            "SELECT id,name,permissions,reserved FROM roles WHERE tenant_id=$1 ORDER BY reserved DESC,name",
            [tenantId],
          )
        ).rows,
        permissionCatalog: permissionCeilings[tenant.kind as TenantKind],
      };
    },
  );
  app.post<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/roles",
    async (request, reply) => {
      const tenantId = uuid(request.params.tenantId),
        input = roleInputSchema.parse(request.body),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "tenant.roles.manage");
        const tenant = (
          await db.query("SELECT kind FROM tenants WHERE id=$1", [tenantId])
        ).rows[0];
        assert(
          validateRolePermissions(
            tenant.kind,
            input.permissions,
            await permissionsFor(db, actor, tenantId),
          ),
          403,
          "A role cannot exceed your permissions or workspace scope.",
        );
        const role = (
          await db.query(
            "INSERT INTO roles(tenant_id,name,permissions) VALUES($1,$2,$3) RETURNING id,name,permissions,reserved",
            [tenantId, input.name, [...new Set(input.permissions)]],
          )
        ).rows[0];
        await audit(db, actor.id, tenantId, "role.created", role.id);
        return created(reply, role);
      });
    },
  );
  app.put<{ Params: { tenantId: string; roleId: string } }>(
    "/api/tenants/:tenantId/roles/:roleId",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        roleId = uuid(request.params.roleId),
        input = roleInputSchema.parse(request.body),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
          tenantId,
        ]);
        await authorize(db, actor, tenantId, "tenant.roles.manage");
        const existing = (
          await db.query(
            "SELECT * FROM roles WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
            [roleId, tenantId],
          )
        ).rows[0];
        assert(existing, 404, "Role not found.");
        assert(
          !existing.reserved,
          403,
          "The recovery administrator role cannot be edited. Create a custom role instead.",
        );
        const kind = (
          await db.query("SELECT kind FROM tenants WHERE id=$1", [tenantId])
        ).rows[0].kind;
        const own = await permissionsFor(db, actor, tenantId);
        assert(
          existing.permissions.every((p: Permission) => own.includes(p)) &&
            validateRolePermissions(kind, input.permissions, own),
          403,
          "You cannot change a role beyond your permissions.",
        );
        const updated = await db.query(
          "UPDATE roles SET name=$3,permissions=$4 WHERE id=$1 AND tenant_id=$2 RETURNING id,name,permissions,reserved",
          [roleId, tenantId, input.name, [...new Set(input.permissions)]],
        );
        await audit(db, actor.id, tenantId, "role.updated", roleId);
        return updated.rows[0];
      });
    },
  );
  app.get<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/members",
    async (request) => {
      const tenantId = uuid(request.params.tenantId);
      await authorize(pool, request.actor!, tenantId, "tenant.members.manage");
      return {
        members: (
          await pool.query(
            `SELECT m.id,m.user_id,m.role_id,m.status,u.name,u.email,r.name AS role_name FROM memberships m JOIN users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id AND r.tenant_id=m.tenant_id WHERE m.tenant_id=$1 ORDER BY u.name LIMIT 200`,
            [tenantId],
          )
        ).rows,
      };
    },
  );
  app.patch<{ Params: { tenantId: string; membershipId: string } }>(
    "/api/tenants/:tenantId/members/:membershipId",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        memberId = uuid(request.params.membershipId),
        input = z
          .strictObject({
            roleId: z.uuid().optional(),
            status: z.enum(["active", "revoked"]),
          })
          .parse(request.body),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
          tenantId,
        ]);
        await authorize(db, actor, tenantId, "tenant.members.manage");
        const member = (
          await db.query(
            "SELECT m.*,r.reserved,r.permissions FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.id=$1 AND m.tenant_id=$2 FOR UPDATE OF m",
            [memberId, tenantId],
          )
        ).rows[0];
        assert(member, 404, "Member not found.");
        const own = await permissionsFor(db, actor, tenantId);
        assert(
          member.permissions.every((p: Permission) => own.includes(p)),
          403,
          "You cannot change a more privileged member.",
        );
        const roleId = input.roleId ?? member.role_id;
        const role = (
          await db.query("SELECT * FROM roles WHERE id=$1 AND tenant_id=$2", [
            roleId,
            tenantId,
          ])
        ).rows[0];
        assert(role, 400, "Select a role from this workspace.");
        assert(
          role.permissions.every((p: Permission) => own.includes(p)),
          403,
          "You cannot grant permissions you do not hold.",
        );
        if (
          member.reserved &&
          member.status === "active" &&
          (input.status === "revoked" || !role.reserved)
        ) {
          const owners = await db.query(
            "SELECT 1 FROM memberships m JOIN roles r ON r.id=m.role_id JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.status='active' AND r.reserved AND NOT u.disabled AND (m.expires_at IS NULL OR m.expires_at>now()) AND m.id<>$2",
            [tenantId, memberId],
          );
          assert(
            owners.rowCount,
            409,
            "Keep at least one active workspace administrator.",
          );
        }
        await db.query(
          "UPDATE memberships SET role_id=$3,status=$4 WHERE id=$1 AND tenant_id=$2",
          [memberId, tenantId, roleId, input.status],
        );
        await audit(db, actor.id, tenantId, "membership.updated", memberId, {
          roleId,
          status: input.status,
        });
        return { updated: true };
      });
    },
  );
  app.post<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/invitations",
    async (request, reply) => {
      const tenantId = uuid(request.params.tenantId),
        input = z
          .strictObject({ email: z.email(), roleId: z.uuid() })
          .parse(request.body),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "tenant.members.manage");
        const role = (
          await db.query("SELECT * FROM roles WHERE id=$1 AND tenant_id=$2", [
            input.roleId,
            tenantId,
          ])
        ).rows[0];
        assert(role, 400, "Select a role from this workspace.");
        const own = await permissionsFor(db, actor, tenantId);
        assert(
          role.permissions.every((p: Permission) => own.includes(p)),
          403,
          "You cannot grant permissions you do not hold.",
        );
        return created(
          reply,
          await makeInvitation(db, actor, config, {
            tenantId,
            email: input.email,
            roleId: input.roleId,
          }),
        );
      });
    },
  );
  app.get<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/invitations",
    async (request) => {
      const tenantId = uuid(request.params.tenantId);
      const own = await permissionsFor(pool, request.actor!, tenantId);
      assert(
        own.includes("tenant.members.manage") ||
          own.includes("partner.accounts.manage"),
        403,
        "Invitation management access is required.",
      );
      return {
        invitations: (
          await pool.query(
            "SELECT id,tenant_id,email,role_id,shipment_id,expires_at,accepted_at,revoked_at FROM invitations WHERE tenant_id=$1 OR ($2 AND authority_tenant_id=$1) ORDER BY expires_at DESC LIMIT 200",
            [tenantId, own.includes("partner.accounts.manage")],
          )
        ).rows,
      };
    },
  );
  app.delete<{ Params: { tenantId: string; invitationId: string } }>(
    "/api/tenants/:tenantId/invitations/:invitationId",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        id = uuid(request.params.invitationId),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        const own = await permissionsFor(db, actor, tenantId);
        assert(
          own.includes("tenant.members.manage") ||
            own.includes("partner.accounts.manage"),
          403,
          "Invitation management access is required.",
        );
        const invitation = (
          await db.query(
            "SELECT tenant_id,authority_tenant_id FROM invitations WHERE id=$1 AND (tenant_id=$2 OR authority_tenant_id=$2)",
            [id, tenantId],
          )
        ).rows[0];
        if (invitation) {
          await authorize(
            db,
            actor,
            tenantId,
            invitation.tenant_id === tenantId
              ? "tenant.members.manage"
              : "partner.accounts.manage",
          );
          await db.query(
            "UPDATE invitations SET revoked_at=now() WHERE id=$1 AND accepted_at IS NULL",
            [id],
          );
        }
        await audit(db, actor.id, tenantId, "invitation.revoked", id);
        return { revoked: true };
      });
    },
  );
  app.post("/api/invitations/accept", async (request) => {
    const input = z
        .strictObject({ token: z.string().min(40).max(128) })
        .parse(request.body),
      actor = request.actor!;
    assert(
      actor.emailVerified,
      403,
      "Verify your email address with the identity provider before accepting an invitation.",
    );
    return transaction(pool, actor.id, async (db) => {
      const invitation = (
        await db.query(
          "SELECT * FROM invitations WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE",
          [tokenHash(input.token)],
        )
      ).rows[0];
      assert(
        invitation,
        410,
        "This invitation expired, was revoked, or has already been used.",
      );
      assert(
        invitation.email === actor.email.toLowerCase() &&
          invitation.issuer === actor.issuer,
        403,
        "Sign in with the invited verified email address and the same identity provider as your inviter.",
      );
      // Recheck the inviter at redemption; revoked administrators cannot leave usable invitations.
      const inviter = { ...actor, id: invitation.created_by } as Actor;
      if (invitation.authority_tenant_id === null) {
        assert(
          (
            await db.query(
              "SELECT 1 FROM operators o JOIN users u ON u.id=o.user_id WHERE o.user_id=$1 AND NOT u.disabled",
              [invitation.created_by],
            )
          ).rowCount,
          403,
          "The platform invitation authority is no longer valid.",
        );
      } else if (invitation.authority_tenant_id !== invitation.tenant_id) {
        const tenant = (
          await db.query(
            "SELECT parent_id FROM tenants WHERE id=$1 AND status=$2",
            [invitation.tenant_id, "active"],
          )
        ).rows[0];
        assert(
          tenant?.parent_id === invitation.authority_tenant_id,
          403,
          "The invitation authority is no longer valid.",
        );
        await authorize(
          db,
          inviter,
          invitation.authority_tenant_id,
          "partner.accounts.manage",
        );
      } else
        await authorize(
          db,
          inviter,
          invitation.tenant_id,
          "tenant.members.manage",
        );
      if (invitation.role_id) {
        const role = (
          await db.query(
            "SELECT permissions FROM roles WHERE id=$1 AND tenant_id=$2",
            [invitation.role_id, invitation.tenant_id],
          )
        ).rows[0];
        assert(role, 410, "The invited role no longer exists.");
        if (invitation.authority_tenant_id === invitation.tenant_id) {
          const own = await permissionsFor(db, inviter, invitation.tenant_id);
          assert(
            role.permissions.every((p: Permission) => own.includes(p)),
            403,
            "The inviter no longer holds the required permissions.",
          );
        }
        const current = (
          await db.query(
            "SELECT 1 FROM memberships WHERE user_id=$1 AND tenant_id=$2 AND status=$3",
            [actor.id, invitation.tenant_id, "active"],
          )
        ).rowCount;
        assert(
          !current,
          409,
          "You already have a membership here. Ask an administrator to change your role.",
        );
        await db.query(
          "INSERT INTO memberships(user_id,tenant_id,role_id) VALUES($1,$2,$3) ON CONFLICT(user_id,tenant_id) DO UPDATE SET role_id=EXCLUDED.role_id,status='active',expires_at=NULL",
          [actor.id, invitation.tenant_id, invitation.role_id],
        );
      } else {
        await db.query(
          `INSERT INTO shipment_grants(tenant_id,shipment_id,user_id,permissions,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6)
 ON CONFLICT(shipment_id,user_id) DO UPDATE SET permissions=EXCLUDED.permissions,expires_at=EXCLUDED.expires_at,revoked_at=NULL,created_by=EXCLUDED.created_by`,
          [
            invitation.tenant_id,
            invitation.shipment_id,
            actor.id,
            invitation.permissions,
            invitation.expires_at,
            invitation.created_by,
          ],
        );
      }
      await db.query("UPDATE invitations SET accepted_at=now() WHERE id=$1", [
        invitation.id,
      ]);
      await audit(
        db,
        actor.id,
        invitation.tenant_id,
        "invitation.accepted",
        invitation.id,
      );
      return {
        tenantId: invitation.tenant_id,
        shipmentId: invitation.shipment_id,
      };
    });
  });
  app.get<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/audit",
    async (request) => {
      const tenantId = uuid(request.params.tenantId),
        actor = request.actor!;
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, tenantId, "tenant.audit.read");
        return {
          events: (
            await db.query(
              "SELECT e.id,e.actor_id,u.name AS actor_name,u.email AS actor_email,e.action,e.resource_id,e.metadata,e.created_at FROM audit_events e JOIN users u ON u.id=e.actor_id WHERE e.tenant_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100",
              [tenantId],
            )
          ).rows,
        };
      });
    },
  );
  app.get<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/accounts",
    async (request) => {
      const parentId = uuid(request.params.tenantId);
      await authorize(
        pool,
        request.actor!,
        parentId,
        "partner.accounts.manage",
      );
      return {
        accounts: (
          await pool.query(
            "SELECT id,name,status,revision FROM tenants WHERE parent_id=$1 AND kind='account' ORDER BY name LIMIT 200",
            [parentId],
          )
        ).rows,
      };
    },
  );
  app.post<{ Params: { tenantId: string } }>(
    "/api/tenants/:tenantId/accounts",
    async (request, reply) => {
      const parentId = uuid(request.params.tenantId),
        input = z
          .strictObject({
            name: z.string().trim().min(1).max(200),
            ownerEmail: z.email(),
          })
          .parse(request.body),
        actor = request.actor!;
      requireMfa(actor, config);
      return transaction(pool, actor.id, async (db) => {
        await authorize(db, actor, parentId, "partner.accounts.manage");
        assert(
          (
            await db.query(
              "SELECT 1 FROM tenants WHERE id=$1 AND kind='partner'",
              [parentId],
            )
          ).rowCount,
          400,
          "Accounts must belong to a partner.",
        );
        const tenant = await createTenant(
          db,
          "account",
          input.name,
          parentId,
          null,
        );
        const role = (
          await db.query(
            "SELECT id FROM roles WHERE tenant_id=$1 AND key='owner'",
            [tenant.id],
          )
        ).rows[0];
        const invitation = await makeInvitation(db, actor, config, {
          tenantId: tenant.id,
          authorityTenantId: parentId,
          email: input.ownerEmail,
          roleId: role.id,
        });
        await audit(db, actor.id, parentId, "account.created", tenant.id);
        return created(reply, {
          account: { id: tenant.id, name: tenant.name },
          invitation,
        });
      });
    },
  );
  app.delete<{ Params: { invitationId: string } }>(
    "/api/platform/invitations/:invitationId",
    async (request) => {
      const actor = request.actor!;
      requireMfa(actor, config);
      assert(actor.operator, 403, "Platform operator access is required.");
      const id = uuid(request.params.invitationId);
      return transaction(pool, actor.id, async (db) => {
        const invitation = (
          await db.query(
            "UPDATE invitations SET revoked_at=now() WHERE id=$1 AND authority_tenant_id IS NULL AND accepted_at IS NULL RETURNING tenant_id",
            [id],
          )
        ).rows[0];
        if (invitation)
          await audit(
            db,
            actor.id,
            invitation.tenant_id,
            "invitation.revoked",
            id,
          );
        return { revoked: true };
      });
    },
  );
  app.post("/api/platform/partners", async (request, reply) => {
    const actor = request.actor!;
    requireMfa(actor, config);
    assert(actor.operator, 403, "Platform operator access is required.");
    const input = z
      .strictObject({
        name: z.string().trim().min(1).max(200),
        ownerEmail: z.email(),
      })
      .parse(request.body);
    // Operators provision an invitation, never an implicit customer-data membership.
    return transaction(pool, actor.id, async (db) => {
      const tenant = await createTenant(db, "partner", input.name, null, null);
      const role = (
        await db.query(
          "SELECT id FROM roles WHERE tenant_id=$1 AND key='owner'",
          [tenant.id],
        )
      ).rows[0];
      await audit(db, actor.id, tenant.id, "partner.created", tenant.id);
      const invitation = await makeInvitation(db, actor, config, {
        tenantId: tenant.id,
        authorityTenantId: null,
        email: input.ownerEmail,
        roleId: role.id,
      });
      return created(reply, { id: tenant.id, name: tenant.name, invitation });
    });
  });
}
