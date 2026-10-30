import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Share2,
  Search,
  ArrowRight,
  Copy,
  FileText,
  CheckCircle2,
  ArrowUpRight,
  Building2,
  X,
  LoaderCircle,
} from "lucide-react";
import {
  createBlankShipment,
  money,
  type TenantAccess,
  type SessionContext,
  type SettingsView,
  type Shipment,
  type ShipmentList,
} from "@freightnaut/domain";
import type { ApiClient } from "./api";
import { ShipmentEditor, countryName } from "./ShipmentEditor";
import { PageHeader, Skeleton, Dialog, CopyLink, DocumentArtwork } from "./ui";
interface RecordValue {
  id: string;
  data: Shipment;
  version: number;
  settings?: SettingsView;
}
const blankList: ShipmentList = {
  shipments: [],
  nextCursor: null,
  total: 0,
  updatedRecent: 0,
  matched: 0,
};
export function ShipmentPage({
  tenant,
  shared,
  settings,
  api,
  selectedId,
  onSelected,
  onConfigure,
}: {
  tenant?: TenantAccess;
  shared?: SessionContext["sharedShipments"][number];
  settings: SettingsView;
  api: ApiClient;
  selectedId: string | null;
  onSelected: (id: string | null) => void;
  onConfigure: () => void;
}) {
  const tenantId = tenant?.id ?? shared!.tenantId,
    [list, setList] = useState<ShipmentList>(blankList),
    [record, setRecord] = useState<RecordValue | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(""),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [recent, setRecent] = useState(false),
    [share, setShare] = useState(false),
    [email, setEmail] = useState(""),
    [allowDownload, setAllowDownload] = useState(false),
    [inviteUrl, setInviteUrl] = useState(""),
    [grants, setGrants] = useState<
      {
        id: string;
        name: string;
        email: string;
        expires_at: string;
        revoked_at: string | null;
      }[]
    >([]);
  const loaded = useRef<string | null>(null);
  const canWrite = !!tenant?.permissions.includes("shipment.write"),
    canDownload =
      (tenant?.permissions ?? shared?.permissions)?.includes(
        "document.download",
      ) ?? false,
    canManage = !!tenant?.permissions.includes("tenant.members.manage");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const listPath = `/api/tenants/${tenantId}/shipments?q=${encodeURIComponent(search)}&recent=${recent}`;
  useEffect(() => {
    const id = shared?.id ?? selectedId;
    const controller = new AbortController();
    if (id) {
      if (loaded.current === id) return;
      setLoading(true);
      setError("");
      void api<RecordValue>(`/api/tenants/${tenantId}/shipments/${id}`, {
        signal: controller.signal,
      })
        .then((value) => {
          loaded.current = id;
          setRecord(value);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    } else {
      loaded.current = null;
      setRecord(null);
      setLoading(true);
      setError("");
      void api<ShipmentList>(listPath, { signal: controller.signal })
        .then(setList)
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => controller.abort();
  }, [selectedId, shared?.id, listPath, retry]);
  useEffect(() => {
    if (!share || !record) return;
    void api<{ grants: typeof grants }>(
      `/api/tenants/${tenantId}/shipments/${record.id}/collaborators`,
    )
      .then((value) => setGrants(value.grants))
      .catch((error) => setError(error.message));
  }, [share, record?.id]);
  async function create(copyId?: string) {
    if (busy) return;
    setBusy(copyId ?? "new");
    setError("");
    try {
      const value = await api<RecordValue>(
        `/api/tenants/${tenantId}/shipments` +
          (copyId ? "/" + copyId + "/copy" : ""),
        {
          method: "POST",
          ...(copyId
            ? {}
            : { body: JSON.stringify(createBlankShipment(settings.values)) }),
        },
      );
      loaded.current = value.id;
      setRecord(value);
      onSelected(value.id);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not create the shipment.",
      );
    } finally {
      setBusy("");
    }
  }
  async function loadMore() {
    if (!list.nextCursor || busy) return;
    setBusy("more");
    try {
      const value = await api<ShipmentList>(
        listPath + "&cursor=" + encodeURIComponent(list.nextCursor),
      );
      setList((old) => ({
        ...value,
        shipments: [...old.shipments, ...value.shipments],
      }));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load more shipments.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      {error && (
        <div role="alert" className="error">
          {error}
          <button
            className="text-button"
            onClick={() => {
              loaded.current = null;
              setRetry((value) => value + 1);
              onSelected(null);
              setError("");
            }}
          >
            Back to shipments
          </button>
        </div>
      )}
      {loading && (selectedId || shared) ? (
        <Skeleton label="Opening shipment" />
      ) : record ? (
        <>
          <div className="shipment-editor-heading">
            <div className="editor-breadcrumb">
              <FileText size={16} />
              <span>Shipment workspace</span>
            </div>
            {canManage && (
              <button
                className="secondary"
                onClick={() => {
                  setShare(true);
                  setInviteUrl("");
                }}
              >
                <Share2 size={16} />
                Share shipment
              </button>
            )}
          </div>
          <ShipmentEditor
            key={record.id}
            initial={record}
            tenantId={tenantId}
            settings={(record.settings ?? settings).values}
            api={api}
            canWrite={canWrite}
            canDownload={canDownload}
            canNumber={
              !!tenant?.permissions.includes("document.number.reserve")
            }
            onBack={() => {
              if (shared) return;
              loaded.current = null;
              setRecord(null);
              setShare(false);
              onSelected(null);
            }}
          />
        </>
      ) : (
        <>
          <PageHeader
            title="Your shipments"
            description={`Every shipment, document and detail. Together in ${tenant?.name ?? "your workspace"}.`}
            actions={
              canWrite && (
                <button
                  className="primary"
                  onClick={() => void create()}
                  disabled={!!busy}
                >
                  {busy === "new" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Plus size={18} />
                  )}
                  New shipment
                </button>
              )
            }
          />
          {!loading && list.total > 0 && (
            <div className="shipment-overview">
              <div>
                <span className="overview-icon">
                  <FileText size={20} />
                </span>
                <span>
                  <strong>{list.total}</strong>
                  <small>Total shipments</small>
                </span>
              </div>
              <i />
              <div>
                <span className="overview-icon pale">
                  <ArrowUpRight size={20} />
                </span>
                <span>
                  <strong>{list.updatedRecent}</strong>
                  <small>Updated in the last 7 days</small>
                </span>
              </div>
              <div className="overview-caption">
                <CheckCircle2 size={17} />
                <span>One source for your invoice and packing list</span>
              </div>
            </div>
          )}
          {loading && list.total === 0 ? (
            <Skeleton label="Loading shipments" />
          ) : list.total === 0 ? (
            <section className="empty-workspace">
              <div className="empty-workspace-copy">
                <span className="empty-icon">
                  <FileText size={24} />
                </span>
                <h2>Your first shipment starts here.</h2>
                <p>
                  Add the details once. We’ll keep your commercial invoice and
                  packing list in sync as you work.
                </p>
                {canWrite ? (
                  <button
                    className="primary"
                    onClick={() => void create()}
                    disabled={!!busy}
                  >
                    <Plus size={17} />
                    Create shipment
                  </button>
                ) : (
                  <p>
                    Your team’s shipments will appear here when they’re created.
                  </p>
                )}
                <div className="empty-steps">
                  <span>
                    <b>1</b>Shipment details
                  </span>
                  <span>
                    <b>2</b>Live documents
                  </span>
                  <span>
                    <b>3</b>Review & download
                  </span>
                </div>
              </div>
              <DocumentArtwork />
            </section>
          ) : (
            <section className="shipment-library">
              <div className="library-toolbar">
                <div className="filter-tabs" aria-label="Shipment period">
                  <button
                    className={!recent ? "selected" : ""}
                    aria-pressed={!recent}
                    onClick={() => setRecent(false)}
                  >
                    All shipments <span>{list.total}</span>
                  </button>
                  <button
                    className={recent ? "selected" : ""}
                    aria-pressed={recent}
                    onClick={() => setRecent(true)}
                  >
                    Last 7 days
                  </button>
                </div>
                <div className="list-search">
                  <Search size={17} />
                  <input
                    aria-label="Search shipments"
                    placeholder="Search reference or consignee…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="table-scroll" aria-busy={loading}>
                <table className="shipment-table">
                  <thead>
                    <tr>
                      <th>Shipment</th>
                      <th>Consignee</th>
                      <th>Route</th>
                      <th>Readiness</th>
                      <th className="right">Value</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.shipments.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button
                            className="shipment-reference"
                            onClick={() => onSelected(row.id)}
                          >
                            <span className="document-icon">
                              <FileText size={18} />
                            </span>
                            <span>
                              <strong>
                                {row.reference || "Untitled shipment"}
                              </strong>
                              <small>
                                Updated{" "}
                                {new Intl.DateTimeFormat(
                                  settings.values.locale,
                                  {
                                    day: "numeric",
                                    month: "short",
                                    timeZone: settings.values.timeZone,
                                  },
                                ).format(new Date(row.updated_at))}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="consignee-name">
                            {row.consignee || "No consignee yet"}
                          </span>
                          <small>
                            {row.itemCount}{" "}
                            {row.itemCount === 1 ? "goods line" : "goods lines"}
                          </small>
                        </td>
                        <td>
                          <div className="route-cell">
                            <span
                              title={countryName(
                                row.originCountry,
                                settings.values.locale,
                              )}
                            >
                              {row.originCountry || "—"}
                            </span>
                            <ArrowRight size={13} />
                            <span
                              title={countryName(
                                row.destinationCountry,
                                settings.values.locale,
                              )}
                            >
                              {row.destinationCountry || "—"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={
                              "status-pill " +
                              (row.blockerCount
                                ? "status-warning"
                                : "status-success")
                            }
                          >
                            <i />
                            {row.blockerCount
                              ? "Needs details"
                              : "Ready to review"}
                          </span>
                        </td>
                        <td className="right">
                          <strong className="numeric-value">
                            {money(
                              row.value,
                              settings.values.locale,
                              row.currency,
                            )}
                          </strong>
                          <small>{row.currency}</small>
                        </td>
                        <td>
                          <div className="row-actions">
                            {canWrite && (
                              <button
                                className="icon-button"
                                disabled={!!busy}
                                title="Copy shipment"
                                aria-label={
                                  "Copy shipment " +
                                  (row.reference || "Untitled shipment")
                                }
                                onClick={() => void create(row.id)}
                              >
                                {busy === row.id ? (
                                  <LoaderCircle className="spin" size={16} />
                                ) : (
                                  <Copy size={16} />
                                )}
                              </button>
                            )}
                            <button
                              className="text-button open-action"
                              onClick={() => onSelected(row.id)}
                            >
                              Open
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!list.shipments.length && !loading && (
                <div className="search-empty">
                  <Search size={25} />
                  <h3>No shipments match your search</h3>
                  <p>
                    Try a reference or consignee name, or clear your filters.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setQuery("");
                      setRecent(false);
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
              <footer className="library-footer">
                <span>
                  {loading
                    ? "Updating shipments…"
                    : `Showing ${list.shipments.length} of ${list.matched} shipments`}
                </span>
                {list.nextCursor && (
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => void loadMore()}
                  >
                    {busy === "more" ? "Loading…" : "Load more shipments"}
                  </button>
                )}
                <span>
                  <span className="live-dot" />
                  Saved to your workspace
                </span>
              </footer>
            </section>
          )}
          {tenant?.permissions.includes("tenant.settings.write") &&
            !settings.values.exporter.name && (
              <section className="setup-nudge">
                <span className="setup-icon">
                  <Building2 size={23} />
                </span>
                <div>
                  <h3>Make your next shipment even quicker.</h3>
                  <p>
                    Save your exporter details once. We’ll fill them in every
                    time you create a shipment.
                  </p>
                </div>
                <button className="secondary" onClick={onConfigure}>
                  Set company defaults
                  <ArrowRight size={15} />
                </button>
              </section>
            )}
          <div className="workspace-footnote">
            <ShieldIcon />
            Your documents are generated from the same shipment details.
          </div>
        </>
      )}
      {share && record && (
        <Dialog
          title="Share this shipment"
          description="Invite a person to view this shipment. You choose whether they can download draft PDFs."
          onClose={() => setShare(false)}
        >
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy("share");
              void api<{ inviteUrl: string }>(
                `/api/tenants/${tenantId}/shipments/${record.id}/collaborators`,
                {
                  method: "POST",
                  body: JSON.stringify({ email, allowDownload }),
                },
              )
                .then((value) => setInviteUrl(value.inviteUrl))
                .catch((error) => setError(error.message))
                .finally(() => setBusy(""));
            }}
          >
            <label>
              Collaborator’s email
              <input
                autoFocus
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(event) => setAllowDownload(event.target.checked)}
              />
              Allow draft PDF downloads
            </label>
            <button className="primary" disabled={!!busy}>
              {busy === "share" ? "Creating invitation…" : "Create invitation"}
            </button>
            {inviteUrl && <CopyLink value={inviteUrl} />}
          </form>
          {grants.filter(
            (grant) =>
              !grant.revoked_at && new Date(grant.expires_at) > new Date(),
          ).length > 0 && (
            <div className="collaborator-list">
              <h3>People with access</h3>
              {grants
                .filter((grant) => !grant.revoked_at)
                .map((grant) => (
                  <div key={grant.id}>
                    <span>
                      {grant.name || grant.email}
                      <small>{grant.email}</small>
                    </span>
                    <button
                      className="text-button danger-text"
                      onClick={() => {
                        void api(
                          `/api/tenants/${tenantId}/shipments/${record.id}/collaborators/${grant.id}`,
                          { method: "DELETE" },
                        )
                          .then(() =>
                            setGrants((old) =>
                              old.filter((item) => item.id !== grant.id),
                            ),
                          )
                          .catch((error) => setError(error.message));
                      }}
                    >
                      Revoke access
                    </button>
                  </div>
                ))}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
function ShieldIcon() {
  return <CheckCircle2 size={14} />;
}
