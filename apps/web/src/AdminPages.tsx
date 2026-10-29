import { PageHeader, Dialog, CopyLink, Skeleton } from "./ui";
import { Plus, Building2, History, ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";
import type { TenantAccess } from "@freightnaut/domain";
import type { ApiClient } from "./api";
export function AccountsPage({
  tenant,
  api,
}: {
  tenant: TenantAccess;
  api: ApiClient;
}) {
  const [accounts, setAccounts] = useState<
      { id: string; name: string; status: string }[]
    >([]),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [error, setError] = useState(""),
    [invite, setInvite] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setAccounts(
        (
          await api<{ accounts: typeof accounts }>(
            `/api/tenants/${tenant.id}/accounts`,
          )
        ).accounts,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load accounts.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PARTNER CONSOLE</div>
          <h1>Customer accounts</h1>
          <p>
            Customer shipment access requires an explicit membership in that
            account.
          </p>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.name}</td>
                <td>{account.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!accounts.length && <p>No customer accounts yet.</p>}
      </div>
      <form
        className="admin-card admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void api<{ invitation: { inviteUrl: string } }>(
            `/api/tenants/${tenant.id}/accounts`,
            {
              method: "POST",
              body: JSON.stringify({ name, ownerEmail: email }),
            },
          )
            .then(async (result) => {
              setInvite(result.invitation.inviteUrl);
              setName("");
              setEmail("");
              await load();
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <h2>Create an account</h2>
        <label>
          Account name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
        </label>
        <label>
          First administrator’s email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button disabled={busy} className="primary">
          Create account & invitation
        </button>
        {invite && (
          <label>
            Private administrator invitation
            <input readOnly value={invite} />
          </label>
        )}
      </form>
    </>
  );
}
export function AuditPage({
  tenant,
  api,
}: {
  tenant: TenantAccess;
  api: ApiClient;
}) {
  const [events, setEvents] = useState<
      {
        id: string;
        action: string;
        actor_name: string;
        actor_email: string;
        resource_id: string;
        metadata: Record<string, unknown>;
        created_at: string;
      }[]
    >([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<{ events: typeof events }>(`/api/tenants/${tenant.id}/audit`)
      .then((value) => setEvents(value.events))
      .catch((error) => setError(error.message))
      .finally(() => setLoading(false));
  }, []);
  const actionNames: Record<string, string> = {
    "shipment.created": "Created a shipment",
    "shipment.updated": "Updated shipment details",
    "shipment.copied": "Copied a shipment",
    "document.draft_downloaded": "Downloaded a draft document",
    "settings.updated": "Updated workspace settings",
    "role.created": "Created a workspace role",
    "role.updated": "Updated a workspace role",
    "membership.updated": "Changed a person’s access",
    "invitation.created": "Created an invitation",
    "invitation.accepted": "Accepted an invitation",
    "invitation.revoked": "Revoked an invitation",
    "collaborator.revoked": "Removed shipment access",
    "account.created": "Created a customer account",
    "workspace.created": "Created the workspace",
    "workspace.bootstrapped": "Set up workspace access",
  };
  return (
    <>
      <PageHeader
        title="Workspace activity"
        description="A clear record of the changes made by your team."
      />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <Skeleton label="Loading workspace activity" />
      ) : (
        <div className="admin-card table-scroll">
          {events.length ? (
            <table className="admin-table activity-table">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <span className="activity-action">
                        <span className="activity-dot" />
                        {actionNames[event.action] ??
                          event.action
                            .replaceAll(".", " ")
                            .replaceAll("_", " ")}
                      </span>
                      {typeof event.metadata.version === "number" && (
                        <small>Shipment version {event.metadata.version}</small>
                      )}
                    </td>
                    <td>
                      <strong>{event.actor_name || event.actor_email}</strong>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(event.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="search-empty">
              <History size={27} />
              <h3>Your activity will appear here</h3>
              <p>
                Changes to shipments, settings and access are recorded
                automatically.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
export function PlatformPage({ api }: { api: ApiClient }) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [error, setError] = useState(""),
    [invite, setInvite] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PLATFORM OPERATIONS</div>
          <h1>Provision a partner</h1>
          <p>
            Creating a partner does not grant you access to its customers’
            shipments.
          </p>
        </div>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <form
        className="admin-card admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void api<{ invitation: { inviteUrl: string } }>(
            "/api/platform/partners",
            {
              method: "POST",
              body: JSON.stringify({ name, ownerEmail: email }),
            },
          )
            .then((result) => {
              setInvite(result.invitation.inviteUrl);
              setName("");
              setEmail("");
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Partner name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          First administrator’s email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          Create partner & invitation
        </button>
        {invite && (
          <label>
            Private administrator invitation
            <input readOnly value={invite} />
          </label>
        )}
      </form>
    </>
  );
}
