import { useState, useEffect } from "react";
import { Plus, Share2 } from "lucide-react";
import {
  createBlankShipment,
  type TenantAccess,
  type SessionContext,
  type SettingsView,
  type Shipment,
} from "@freightnaut/domain";
import type { ApiClient } from "./api";
import { ShipmentEditor } from "./ShipmentEditor";
interface RecordValue {
  id: string;
  data: Shipment;
  version: number;
  settings?: SettingsView;
}
export function ShipmentPage({
  tenant,
  shared,
  settings,
  api,
}: {
  tenant?: TenantAccess;
  shared?: SessionContext["sharedShipments"][number];
  settings: SettingsView;
  api: ApiClient;
}) {
  const tenantId = tenant?.id ?? shared!.tenantId;
  const [list, setList] = useState<
      {
        id: string;
        reference: string;
        consignee: string;
        version: number;
        updated_at: string;
      }[]
    >([]),
    [record, setRecord] = useState<RecordValue | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [share, setShare] = useState(false),
    [email, setEmail] = useState(""),
    [allowDownload, setAllowDownload] = useState(false),
    [inviteUrl, setInviteUrl] = useState("");
  const canWrite = !!tenant?.permissions.includes("shipment.write"),
    canDownload =
      (tenant?.permissions ?? shared?.permissions)?.includes(
        "document.download",
      ) ?? false;
  async function open(id: string) {
    setLoading(true);
    setError("");
    try {
      setRecord(
        await api<RecordValue>(`/api/tenants/${tenantId}/shipments/${id}`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load shipment.");
    } finally {
      setLoading(false);
    }
  }
  async function load() {
    setLoading(true);
    try {
      setList(
        (
          await api<{ shipments: typeof list }>(
            `/api/tenants/${tenantId}/shipments`,
          )
        ).shipments,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load shipments.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (shared) void open(shared.id);
    else void load();
  }, []);
  async function create() {
    setError("");
    try {
      const value = await api<RecordValue>(
        `/api/tenants/${tenantId}/shipments`,
        {
          method: "POST",
          body: JSON.stringify(createBlankShipment(settings.values)),
        },
      );
      setRecord(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create shipment.");
    }
  }
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="empty-state">Loading shipments…</div>
      ) : record ? (
        <>
          {tenant?.permissions.includes("tenant.members.manage") && (
            <div className="share-toolbar">
              <button className="secondary" onClick={() => setShare(!share)}>
                <Share2 size={14} />
                Share shipment
              </button>
            </div>
          )}
          {share && (
            <form
              className="admin-card inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void api<{ inviteUrl: string }>(
                  `/api/tenants/${tenantId}/shipments/${record.id}/collaborators`,
                  {
                    method: "POST",
                    body: JSON.stringify({ email, allowDownload }),
                  },
                )
                  .then((value) => setInviteUrl(value.inviteUrl))
                  .catch((e) => setError(e.message));
              }}
            >
              <label>
                Collaborator’s email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={allowDownload}
                  onChange={(e) => setAllowDownload(e.target.checked)}
                />
                Allow draft PDF downloads
              </label>
              <button className="primary">Create invitation</button>
              {inviteUrl && (
                <label>
                  Copy this private invitation link
                  <input readOnly value={inviteUrl} />
                </label>
              )}
            </form>
          )}
          <ShipmentEditor
            key={record.id}
            initial={record}
            tenantId={tenantId}
            settings={(record.settings ?? settings).values}
            api={api}
            canWrite={canWrite}
            canDownload={canDownload}
            onBack={() => {
              setRecord(null);
              setShare(false);
              void load();
            }}
          />
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">DOCUMENT WORKSPACE</div>
              <h1>Your shipments</h1>
              <p>Create and manage the shipments in {tenant?.name}.</p>
            </div>
            {canWrite && (
              <button className="primary" onClick={create}>
                <Plus size={16} />
                New shipment
              </button>
            )}
          </div>
          {list.length ? (
            <div className="admin-card table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Consignee</th>
                    <th>Last saved</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.id}>
                      <td>{row.reference || "Untitled shipment"}</td>
                      <td>{row.consignee || "—"}</td>
                      <td>
                        {new Intl.DateTimeFormat(settings.values.locale, {
                          dateStyle: "medium",
                          timeZone: settings.values.timeZone,
                        }).format(new Date(row.updated_at))}
                      </td>
                      <td>
                        <button
                          className="secondary"
                          onClick={() => void open(row.id)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <section className="empty-state">
              <h2>No shipments yet</h2>
              <p>
                {canWrite
                  ? "Start with a new shipment. Your account’s defaults will be filled in."
                  : "Your account has no shipments available to review."}
              </p>
              {canWrite && (
                <button className="primary" onClick={create}>
                  Create shipment
                </button>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
