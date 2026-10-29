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
        actor_id: string;
        resource_id: string;
        created_at: string;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    void api<{ events: typeof events }>(`/api/tenants/${tenant.id}/audit`)
      .then((r) => setEvents(r.events))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE ACTIVITY</div>
          <h1>Audit history</h1>
          <p>The most recent 100 administrative and document events.</p>
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
              <th>Action</th>
              <th>Actor</th>
              <th>Resource</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.action}</td>
                <td>
                  <code>{event.actor_id}</code>
                </td>
                <td>
                  <code>{event.resource_id}</code>
                </td>
                <td>{new Date(event.created_at).toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && <p>No events yet.</p>}
      </div>
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
