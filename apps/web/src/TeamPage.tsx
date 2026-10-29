import { useEffect, useState } from "react";
import type { TenantAccess, Permission } from "@freightnaut/domain";
import type { ApiClient } from "./api";
type Role = {
  id: string;
  name: string;
  permissions: Permission[];
  reserved: boolean;
};
type Member = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role_id: string;
  role_name: string;
  status: string;
};
export function TeamPage({
  tenant,
  api,
  onChanged,
}: {
  tenant: TenantAccess;
  api: ApiClient;
  onChanged: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [roles, setRoles] = useState<Role[]>([]),
    [catalog, setCatalog] = useState<Permission[]>([]),
    [invitations, setInvitations] = useState<
      {
        id: string;
        email: string;
        accepted_at: string | null;
        revoked_at: string | null;
        expires_at: string;
      }[]
    >([]);
  const [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [roleId, setRoleId] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [roleName, setRoleName] = useState(""),
    [editingRole, setEditingRole] = useState(""),
    [permissions, setPermissions] = useState<Permission[]>([]),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const [m, r, i] = await Promise.all([
        api<{ members: Member[] }>(`/api/tenants/${tenant.id}/members`),
        api<{ roles: Role[]; permissionCatalog: Permission[] }>(
          `/api/tenants/${tenant.id}/roles`,
        ),
        api<{ invitations: typeof invitations }>(
          `/api/tenants/${tenant.id}/invitations`,
        ),
      ]);
      setMembers(m.members);
      setRoles(r.roles);
      setCatalog(r.permissionCatalog);
      setInvitations(i.invitations);
      setRoleId(
        (old) =>
          old ||
          r.roles.find((role) => !role.reserved)?.id ||
          r.roles[0]?.id ||
          "",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load access settings.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
      await onChanged();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PEOPLE & ACCESS</div>
          <h1>Who can access this workspace?</h1>
          <p>
            Roles apply only to {tenant.name}. A user’s access in other
            workspaces is separate.
          </p>
        </div>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="admin-card table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <strong>{member.name}</strong>
                  <small>{member.email}</small>
                </td>
                <td>
                  <select
                    aria-label={"Role for " + member.email}
                    disabled={busy}
                    value={member.role_id}
                    onChange={(e) =>
                      void action(() =>
                        api(`/api/tenants/${tenant.id}/members/${member.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            roleId: e.target.value,
                            status: member.status,
                          }),
                        }),
                      )
                    }
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{member.status}</td>
                <td>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        api(`/api/tenants/${tenant.id}/members/${member.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            status:
                              member.status === "active" ? "revoked" : "active",
                          }),
                        }),
                      )
                    }
                  >
                    {member.status === "active"
                      ? "Revoke access"
                      : "Restore access"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="admin-card admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const invite = await api<{ inviteUrl: string }>(
              `/api/tenants/${tenant.id}/invitations`,
              { method: "POST", body: JSON.stringify({ email, roleId }) },
            );
            setInviteUrl(invite.inviteUrl);
            setEmail("");
          });
        }}
      >
        <h2>Invite a person</h2>
        <p>The recipient must sign in with this verified email address.</p>
        <div className="form-columns">
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Role
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy} className="primary">
            Create invitation
          </button>
        </div>
        {inviteUrl && (
          <label className="invite-result">
            Copy and share this private invitation link
            <input readOnly value={inviteUrl} />
            <small>
              This link is shown once and expires automatically. No email has
              been sent.
            </small>
          </label>
        )}
      </form>
      <div className="admin-card">
        <h2>Invitations</h2>
        {invitations.length ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invitations.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.email}</td>
                  <td>
                    {invite.accepted_at
                      ? "Accepted"
                      : invite.revoked_at
                        ? "Revoked"
                        : new Date(invite.expires_at) < new Date()
                          ? "Expired"
                          : "Pending"}
                  </td>
                  <td>
                    {!invite.accepted_at && !invite.revoked_at && (
                      <button
                        disabled={busy}
                        className="secondary"
                        onClick={() =>
                          void action(() =>
                            api(
                              `/api/tenants/${tenant.id}/invitations/${invite.id}`,
                              { method: "DELETE" },
                            ),
                          )
                        }
                      >
                        Revoke invitation
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No invitations yet.</p>
        )}
      </div>
      {tenant.permissions.includes("tenant.roles.manage") && (
        <form
          className="admin-card admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await api(
                `/api/tenants/${tenant.id}/roles` +
                  (editingRole ? "/" + editingRole : ""),
                {
                  method: editingRole ? "PUT" : "POST",
                  body: JSON.stringify({ name: roleName, permissions }),
                },
              );
              setEditingRole("");
              setRoleName("");
              setPermissions([]);
            });
          }}
        >
          <h2>Custom roles</h2>
          <p>
            Choose only the permissions this role needs. Reserved administrator
            roles preserve a recovery path.
          </p>
          <label>
            Edit a role
            <select
              value={editingRole}
              onChange={(e) => {
                setEditingRole(e.target.value);
                const role = roles.find((r) => r.id === e.target.value);
                setRoleName(role?.name ?? "");
                setPermissions(role?.permissions ?? []);
              }}
            >
              <option value="">Create a new role</option>
              {roles
                .filter((r) => !r.reserved)
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Role name
            <input
              required
              maxLength={100}
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
            />
          </label>
          <div className="permissions-grid">
            {catalog
              .filter((permission) => tenant.permissions.includes(permission))
              .map((permission) => (
                <label className="checkbox-label" key={permission}>
                  <input
                    type="checkbox"
                    checked={permissions.includes(permission)}
                    onChange={(e) =>
                      setPermissions((old) =>
                        e.target.checked
                          ? [...old, permission]
                          : old.filter((p) => p !== permission),
                      )
                    }
                  />
                  {permission}
                </label>
              ))}
          </div>
          <button disabled={busy} className="primary">
            {editingRole ? "Save role" : "Create role"}
          </button>
        </form>
      )}
    </>
  );
}
