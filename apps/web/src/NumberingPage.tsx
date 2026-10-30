// filepath: apps/web/src/NumberingPage.tsx
import { useEffect, useRef, useState } from "react";
import { Plus, Save, Hash, Trash2, ArrowRight } from "lucide-react";
import {
  seriesSchema,
  formatDocumentNumber,
  type NumberSeries,
  type SeriesRecord,
  type TenantAccess,
  type WorkspaceSettings,
} from "@freightnaut/domain";
import type { ApiClient } from "./api";
import { PageHeader, Skeleton } from "./ui";
import { useNavigationGuard } from "./navigation";
const fresh = (): NumberSeries => ({
  name: "",
  documentType: "invoice",
  prefix: "",
  pattern: "{prefix}/{branch}/{yyyy}/{seq}",
  padding: 4,
  startsAt: 1,
  reset: "calendar",
  financialYearStartMonth: 1,
  separateByBranch: true,
  branches: [{ code: "", name: "" }],
  active: true,
});
export function NumberingPage({
  tenant,
  settings,
  api,
}: {
  tenant: TenantAccess;
  settings: WorkspaceSettings;
  api: ApiClient;
}) {
  const [records, setRecords] = useState<SeriesRecord[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<NumberSeries | null>(null),
    [selected, setSelected] = useState<SeriesRecord | null>(null),
    [saving, setSaving] = useState(false);
  const baseline = useRef(""),
    dirtyRef = useRef(false);
  dirtyRef.current = !!draft && JSON.stringify(draft) !== baseline.current;
  const guard = useNavigationGuard();
  useEffect(
    () =>
      guard(async () => {
        if (dirtyRef.current)
          throw new Error(
            "Save or discard the numbering changes before leaving.",
          );
      }),
    [guard],
  );
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const path = `/api/tenants/${tenant.id}/number-series`,
    canEdit = tenant.permissions.includes("tenant.settings.write");
  async function load() {
    setLoading(true);
    try {
      const result = await api<{ series: SeriesRecord[] }>(path);
      setRecords(result.series);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [path]);
  function choose(record: SeriesRecord | null) {
    if (dirtyRef.current) {
      setError(
        "Save or discard your current changes before opening another series.",
      );
      return;
    }
    const value = record ? structuredClone(record.config) : fresh();
    setSelected(record);
    setDraft(value);
    baseline.current = JSON.stringify(value);
    setError("");
  }
  function change<K extends keyof NumberSeries>(
    key: K,
    value: NumberSeries[K],
  ) {
    setDraft((old) => (old ? { ...old, [key]: value } : old));
  }
  async function save() {
    if (!draft) return;
    const parsed = seriesSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(path + (selected ? "/" + selected.id : ""), {
        method: selected ? "PUT" : "POST",
        body: JSON.stringify(
          selected
            ? { revision: selected.revision, config: parsed.data }
            : parsed.data,
        ),
      });
      dirtyRef.current = false;
      setDraft(null);
      setSelected(null);
      await load();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const example = draft
    ? formatDocumentNumber(
        draft,
        draft.branches[0]?.code || "BRANCH",
        draft.startsAt,
        new Date(),
        settings.timeZone,
      )
    : "";
  return (
    <>
      <PageHeader
        title="Document numbering"
        description="Account-owned series with branch counters and reset periods. Draft previews never consume numbers."
        actions={
          canEdit && (
            <button className="primary" onClick={() => choose(null)}>
              <Plus size={17} />
              New series
            </button>
          )
        }
      />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <Skeleton label="Loading number series" />
      ) : (
        <div className="numbering-layout">
          <section className="series-list" aria-label="Number series">
            {!records.length ? (
              <div className="numbering-empty">
                <Hash size={28} />
                <h2>No series configured</h2>
                <p>
                  {canEdit
                    ? "Create a series before reserving document numbers."
                    : "An account administrator can configure numbering."}
                </p>
              </div>
            ) : (
              records.map((record) => (
                <article
                  key={record.id}
                  className={selected?.id === record.id ? "selected" : ""}
                >
                  <div>
                    <h2>{record.config.name}</h2>
                    <span className="status-pill">
                      {record.config.documentType === "invoice"
                        ? "Commercial invoice"
                        : "Packing list"}{" "}
                      · {record.config.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {record.next.map((next) => (
                    <div className="series-next" key={next.branch}>
                      <small>{next.branch} · Next available estimate</small>
                      <code>{next.number}</code>
                    </div>
                  ))}
                  <div className="series-list-footer">
                    <small>Revision {record.revision}</small>
                    {canEdit && (
                      <button
                        className="text-button"
                        aria-label={"Edit " + record.config.name}
                        onClick={() => choose(record)}
                      >
                        Edit series
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
          {draft && canEdit ? (
            <form
              className="series-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <header>
                <h2>{selected ? "Edit number series" : "New number series"}</h2>
                <p>
                  Changes apply to future reservations. Existing numbers and
                  counters stay intact.
                </p>
              </header>
              <div className="series-fields">
                <div className="field-grid">
                  <label>
                    Series name
                    <input
                      value={draft.name}
                      maxLength={80}
                      onChange={(event) => change("name", event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Document type
                    <select
                      value={draft.documentType}
                      disabled={!!selected}
                      onChange={(event) =>
                        change(
                          "documentType",
                          event.target.value as NumberSeries["documentType"],
                        )
                      }
                    >
                      <option value="invoice">Commercial invoice</option>
                      <option value="packing-list">Packing list</option>
                    </select>
                  </label>
                </div>
                <label>
                  Prefix
                  <input
                    value={draft.prefix}
                    maxLength={20}
                    onChange={(event) => change("prefix", event.target.value)}
                    required
                  />
                  <small>Use A–Z, a–z, digits, hyphens or underscores.</small>
                </label>
                <label>
                  Number pattern
                  <input
                    className="pattern-input"
                    value={draft.pattern}
                    maxLength={100}
                    onChange={(event) => change("pattern", event.target.value)}
                    required
                  />
                </label>
                <div className="pattern-tokens" aria-label="Pattern tokens">
                  {["prefix", "branch", "fy", "yyyy", "mm", "seq"].map(
                    (token) => (
                      <button
                        type="button"
                        key={token}
                        onClick={() =>
                          change("pattern", draft.pattern + "{" + token + "}")
                        }
                      >
                        {
                          {
                            prefix: "Prefix",
                            branch: "Branch",
                            fy: "Financial year",
                            yyyy: "Year",
                            mm: "Month",
                            seq: "Running number",
                          }[token]
                        }
                      </button>
                    ),
                  )}
                </div>
                <div className="number-example">
                  <small>Pattern example · Does not reserve a number</small>
                  <code>{example}</code>
                </div>
                <div className="field-grid">
                  <label>
                    Running number padding
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={draft.padding}
                      onChange={(event) =>
                        change("padding", Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    Starts at
                    <input
                      type="number"
                      min={1}
                      max={999999999}
                      value={draft.startsAt}
                      onChange={(event) =>
                        change("startsAt", Number(event.target.value))
                      }
                    />
                    <small>
                      Used only for new counters. Start above numbers already
                      used by your business.
                    </small>
                  </label>
                  <label>
                    Reset period
                    <select
                      value={draft.reset}
                      onChange={(event) =>
                        change(
                          "reset",
                          event.target.value as NumberSeries["reset"],
                        )
                      }
                    >
                      <option value="never">Never</option>
                      <option value="calendar">Calendar year</option>
                      <option value="financial">Financial year</option>
                      <option value="monthly">Each month</option>
                    </select>
                  </label>
                  {draft.reset === "financial" && (
                    <label>
                      Financial year starts
                      <select
                        value={draft.financialYearStartMonth}
                        onChange={(event) =>
                          change(
                            "financialYearStartMonth",
                            Number(event.target.value),
                          )
                        }
                      >
                        {Array.from({ length: 12 }, (_, index) => (
                          <option value={index + 1} key={index}>
                            {new Intl.DateTimeFormat(settings.locale, {
                              month: "long",
                              timeZone: "UTC",
                            }).format(new Date(Date.UTC(2020, index, 1)))}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={draft.separateByBranch}
                    onChange={(event) =>
                      change("separateByBranch", event.target.checked)
                    }
                  />
                  Separate running counter for each branch
                </label>
                <section className="series-branches">
                  <h3>Branches</h3>
                  {draft.branches.map((branch, index) => (
                    <div className="branch-row" key={index}>
                      <label>
                        Branch code {index + 1}
                        <input
                          value={branch.code}
                          maxLength={12}
                          onChange={(event) =>
                            change(
                              "branches",
                              draft.branches.map((old, i) =>
                                i === index
                                  ? {
                                      ...old,
                                      code: event.target.value.toUpperCase(),
                                    }
                                  : old,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Branch name {index + 1}
                        <input
                          value={branch.name}
                          maxLength={80}
                          onChange={(event) =>
                            change(
                              "branches",
                              draft.branches.map((old, i) =>
                                i === index
                                  ? { ...old, name: event.target.value }
                                  : old,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={"Remove branch " + (index + 1)}
                        disabled={draft.branches.length === 1}
                        onClick={() =>
                          change(
                            "branches",
                            draft.branches.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-button"
                    disabled={draft.branches.length >= 50}
                    onClick={() =>
                      change("branches", [
                        ...draft.branches,
                        { code: "", name: "" },
                      ])
                    }
                  >
                    <Plus size={15} />
                    Add branch
                  </button>
                </section>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(event) => change("active", event.target.checked)}
                  />
                  Allow new reservations from this series
                </label>
                <p className="field-hint">
                  Resets use {settings.timeZone}. Estimates can change when
                  another team member reserves a number. Issued-document
                  workflows are not enabled.
                </p>
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => {
                    dirtyRef.current = false;
                    setDraft(null);
                    setSelected(null);
                    setError("");
                  }}
                >
                  Discard changes
                </button>
                <button className="primary" disabled={saving}>
                  <Save size={16} />
                  {saving ? "Saving…" : "Save series"}
                </button>
              </footer>
            </form>
          ) : (
            <div className="series-guide">
              <Hash size={26} />
              <h2>Numbers belong to your account.</h2>
              <p>
                Configure a pattern and branches, then reserve a number from a
                shipment. Numbers are reserved transactionally and never
                recycled after a committed reservation.
              </p>
              <p>
                Voided reservations keep their number and reason in history.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
