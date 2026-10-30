import { useEffect, useState } from "react";
import {
  Plus,
  Users,
  Mail,
  ShieldCheck,
  LockKeyhole,
  UserPlus,
  ArrowRight,
} from "lucide-react";
import type { TenantAccess, Permission } from "@freightnaut/domain";
import type { ApiClient } from "./api";
import { PageHeader, Skeleton, Dialog, CopyLink } from "./ui";
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
const permissionNames: Record<Permission, string> = {
  "shipment.read": "View shipments",
  "shipment.write": "Create and edit shipments",
  "document.download": "Download draft documents",
  "document.number.reserve": "Reserve and void document numbers",
  "tenant.settings.write": "Change workspace settings",
  "tenant.members.manage": "Manage people and invitations",
  "tenant.roles.manage": "Create and edit custom roles",
  "tenant.audit.read": "View workspace activity",
  "partner.accounts.manage": "Create customer accounts",
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
    >([]),
    [tab, setTab] = useState("members"),
    [loading, setLoading] = useState(true),
    [modal, setModal] = useState<"invite" | "role" | null>(null);
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
          [...r.roles]
            .filter((role) => !role.reserved)
            .sort((a, b) => a.permissions.length - b.permissions.length)[0]
            ?.id ||
          r.roles[0]?.id ||
          "",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load access settings.",
      );
    } finally {
      setLoading(false);
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
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  function editRole(role?: Role) {
    setEditingRole(role?.id ?? "");
    setRoleName(role?.name ?? "");
    setPermissions(role?.permissions ?? []);
    setModal("role");
  }
  const activeCount = members.filter(
      (member) => member.status === "active",
    ).length,
    pending = invitations.filter(
      (invite) =>
        !invite.accepted_at &&
        !invite.revoked_at &&
        new Date(invite.expires_at) > new Date(),
    ).length;
  return (
    <>
      <PageHeader
        title="People & access"
        description={`The people who make things happen in ${tenant.name}.`}
        actions={
          <button
            className="primary"
            disabled={loading}
            onClick={() => {
              setModal("invite");
              setInviteUrl("");
              setEmail("");
            }}
          >
            <UserPlus size={17} />
            Invite people
          </button>
        }
      />
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="page-tabs" aria-label="Access management">
        <button
          aria-pressed={tab === "members"}
          className={tab === "members" ? "selected" : ""}
          onClick={() => setTab("members")}
        >
          <Users size={16} />
          Members <span>{activeCount}</span>
        </button>
        <button
          aria-pressed={tab === "invitations"}
          className={tab === "invitations" ? "selected" : ""}
          onClick={() => setTab("invitations")}
        >
          <Mail size={16} />
          Invitations <span>{pending}</span>
        </button>
        {tenant.permissions.includes("tenant.roles.manage") && (
          <button
            aria-pressed={tab === "roles"}
            className={tab === "roles" ? "selected" : ""}
            onClick={() => setTab("roles")}
          >
            <ShieldCheck size={16} />
            Roles & permissions
          </button>
        )}
      </div>
      {loading ? (
        <Skeleton label="Loading people and roles" />
      ) : tab === "members" ? (
        <div className="admin-card table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="person-cell">
                      <span className="person-avatar">
                        {(member.name || member.email)
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      <span>
                        <strong>{member.name || member.email}</strong>
                        <small>{member.email}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={"Role for " + member.email}
                      disabled={busy}
                      value={member.role_id}
                      onChange={(event) =>
                        void action(() =>
                          api(
                            `/api/tenants/${tenant.id}/members/${member.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({
                                roleId: event.target.value,
                                status: member.status,
                              }),
                            },
                          ),
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
                  <td>
                    <span
                      className={
                        "status-pill " +
                        (member.status === "active"
                          ? "status-success"
                          : "status-neutral")
                      }
                    >
                      <i />
                      {member.status === "active" ? "Active" : "Revoked"}
                    </span>
                  </td>
                  <td className="right">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          api(
                            `/api/tenants/${tenant.id}/members/${member.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({
                                status:
                                  member.status === "active"
                                    ? "revoked"
                                    : "active",
                              }),
                            },
                          ),
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
      ) : tab === "invitations" ? (
        <div className="admin-card table-scroll">
          {invitations.length ? (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Invited email</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invitations.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>
                      <span
                        className={
                          "status-pill " +
                          (invite.accepted_at
                            ? "status-success"
                            : "status-neutral")
                        }
                      >
                        {invite.accepted_at
                          ? "Accepted"
                          : invite.revoked_at
                            ? "Revoked"
                            : new Date(invite.expires_at) < new Date()
                              ? "Expired"
                              : "Pending"}
                      </span>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                      }).format(new Date(invite.expires_at))}
                    </td>
                    <td className="right">
                      {!invite.accepted_at && !invite.revoked_at && (
                        <button
                          disabled={busy}
                          className="text-button"
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
            <div className="search-empty">
              <Mail size={28} />
              <h3>No invitations yet</h3>
              <p>
                Invite a teammate and choose what they can do in this workspace.
              </p>
              <button className="secondary" onClick={() => setModal("invite")}>
                Invite someone
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="section-action-row">
            <p>Roles keep the right people in control of the right details.</p>
            <button className="secondary" onClick={() => editRole()}>
              <Plus size={16} />
              Create role
            </button>
          </div>
          <div className="role-grid">
            {roles.map((role) => (
              <section className="role-card" key={role.id}>
                <div className="role-card-heading">
                  <span className="role-icon">
                    <ShieldCheck size={21} />
                  </span>
                  {role.reserved && (
                    <span className="source-badge">
                      <LockKeyhole size={11} />
                      Protected role
                    </span>
                  )}
                </div>
                <h3>{role.name}</h3>
                <p>
                  {role.permissions.length}{" "}
                  {role.permissions.length === 1 ? "permission" : "permissions"}
                </p>
                <ul>
                  {role.permissions.map((permission) => (
                    <li key={permission}>{permissionNames[permission]}</li>
                  ))}
                </ul>
                {role.reserved ? (
                  <small>
                    The administrator role keeps a recovery path for this
                    workspace.
                  </small>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => editRole(role)}
                  >
                    Edit role
                    <ArrowRight size={15} />
                  </button>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      {modal === "invite" && (
        <Dialog
          title="Invite someone to your workspace"
          description="Choose their role. Access applies only to this workspace."
          onClose={() => setModal(null)}
        >
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                const invite = await api<{ inviteUrl: string }>(
                  `/api/tenants/${tenant.id}/invitations`,
                  { method: "POST", body: JSON.stringify({ email, roleId }) },
                );
                setInviteUrl(invite.inviteUrl);
              });
            }}
          >
            <label>
              Email address
              <input
                autoFocus
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Workspace role
              <select
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint">
              The person will need to sign in with this verified email address.
            </p>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button disabled={busy} className="primary">
              {busy ? "Creating invitation…" : "Create invitation"}
            </button>
            {inviteUrl && <CopyLink value={inviteUrl} />}
          </form>
        </Dialog>
      )}
      {modal === "role" && (
        <Dialog
          title={
            editingRole ? "Edit workspace role" : "Create a workspace role"
          }
          description="Give this role only the access it needs."
          onClose={() => setModal(null)}
        >
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                await api(
                  `/api/tenants/${tenant.id}/roles` +
                    (editingRole ? "/" + editingRole : ""),
                  {
                    method: editingRole ? "PUT" : "POST",
                    body: JSON.stringify({ name: roleName, permissions }),
                  },
                );
                setModal(null);
              });
            }}
          >
            <label>
              Role name
              <input
                autoFocus
                required
                maxLength={100}
                placeholder="For example, Operations coordinator"
                value={roleName}
                onChange={(event) => setRoleName(event.target.value)}
              />
            </label>
            <fieldset className="permission-choices">
              <legend>Permissions</legend>
              {catalog
                .filter((permission) => tenant.permissions.includes(permission))
                .map((permission) => (
                  <label className="checkbox-label" key={permission}>
                    <input
                      type="checkbox"
                      checked={permissions.includes(permission)}
                      onChange={(event) =>
                        setPermissions((old) =>
                          event.target.checked
                            ? [...old, permission]
                            : old.filter((item) => item !== permission),
                        )
                      }
                    />
                    {permissionNames[permission]}
                  </label>
                ))}
            </fieldset>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button disabled={busy} className="primary">
              {busy ? "Saving…" : editingRole ? "Save role" : "Create role"}
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
