import { useState } from "react";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { LockKeyhole, RotateCcw } from "lucide-react";
import {
  settingKeys,
  type SettingKey,
  type WorkspaceSettings,
  type SettingsView,
  type TenantAccess,
} from "@freightnaut/domain";
import type { ApiClient } from "./api";
const labels: Record<SettingKey, string> = {
  customFields: "Custom shipment fields",
  brandName: "Workspace brand name",
  primaryColor: "Primary color",
  accentColor: "Accent color",
  locale: "Number and date locale",
  timeZone: "Time zone",
  defaultCurrency: "Default currency",
  originCountry: "Default origin country (ISO code)",
  destinationCountry: "Default destination country (ISO code)",
  defaultIncoterm: "Default Incoterm",
  exporter: "Exporter profile",
  packageLabel: "Package label",
  defaultUnit: "Default goods unit",
  hsCodeDigits: "HS code length",
  buyerPoRequired: "Require buyer PO reference",
  declaration: "Document declaration",
  documentTitles: "Document titles",
  secondaryTitles: "Secondary document titles",
};
export function SettingsPage({
  tenant,
  settings,
  api,
  onSaved,
}: {
  tenant: TenantAccess;
  settings: SettingsView;
  api: ApiClient;
  onSaved: (view: SettingsView) => void;
}) {
  const [overrides, setOverrides] = useState<Partial<WorkspaceSettings>>(() =>
      Object.fromEntries(
        Object.entries(settings.overrides).filter(
          ([key]) =>
            !settings.provenance[key].lockedBy ||
            settings.provenance[key].lockedBy === tenant.kind,
        ),
      ),
    ),
    [locks, setLocks] = useState(settings.locks),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const values = { ...settings.inheritedValues, ...overrides };
  function set<K extends SettingKey>(key: K, value: WorkspaceSettings[K]) {
    setOverrides((old) => ({ ...old, [key]: value }));
  }
  function reset(key: SettingKey) {
    setOverrides((old) => {
      const copy = { ...old };
      delete copy[key];
      return copy;
    });
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      onSaved(
        await api<SettingsView>(`/api/tenants/${tenant.id}/settings`, {
          method: "PUT",
          body: JSON.stringify({
            revision: settings.revision,
            overrides,
            locks,
          }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {tenant.kind.toUpperCase()} CONFIGURATION
          </div>
          <h1>Workspace settings</h1>
          <p>
            Defaults, document wording, regional formats, and settings inherited
            by lower levels.
          </p>
        </div>
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-grid">
        {settingKeys.map((key) => {
          const source = settings.provenance[key];
          const locked = !!source.lockedBy && source.lockedBy !== tenant.kind;
          const nested =
            key === "exporter" ||
            key === "documentTitles" ||
            key === "secondaryTitles";
          return (
            <section className="admin-card setting-card" key={key}>
              <div className="setting-label">
                <strong>{labels[key]}</strong>
                <span className="source-badge">
                  {locked ? (
                    <>
                      <LockKeyhole size={11} />
                      Locked by {source.lockedBy}
                    </>
                  ) : key in overrides ? (
                    "Overridden"
                  ) : (
                    `Inherited · ${source.source}`
                  )}
                </span>
              </div>
              <fieldset disabled={locked} className="editor-fields">
                {key === "customFields" ? (
                  <CustomFieldsEditor
                    fields={values.customFields}
                    existingKeys={settings.values.customFields.map(
                      (field) => field.key,
                    )}
                    onChange={(fields) => set(key, fields)}
                  />
                ) : nested ? (
                  <div className="nested-fields">
                    {Object.entries(values[key]).map(([nestedKey, value]) => (
                      <label key={nestedKey}>
                        {nestedKey === "taxId"
                          ? "Tax identifier"
                          : nestedKey === "packing-list"
                            ? "Packing list"
                            : nestedKey === "invoice"
                              ? "Commercial invoice"
                              : nestedKey}
                        <input
                          value={value}
                          onChange={(e) =>
                            set(key, {
                              ...values[key],
                              [nestedKey]: e.target.value,
                            } as WorkspaceSettings[typeof key])
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : key === "buyerPoRequired" ? (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={values.buyerPoRequired}
                      onChange={(e) => set(key, e.target.checked)}
                    />
                    A missing buyer PO blocks validation
                  </label>
                ) : key === "declaration" ? (
                  <label>
                    <textarea
                      value={values.declaration}
                      rows={4}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </label>
                ) : key === "defaultCurrency" ? (
                  <select
                    aria-label={labels[key]}
                    value={values.defaultCurrency}
                    onChange={(e) => set(key, e.target.value)}
                  >
                    {Intl.supportedValuesOf("currency").map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                ) : key === "hsCodeDigits" ? (
                  <select
                    aria-label={labels[key]}
                    value={values.hsCodeDigits}
                    onChange={(e) =>
                      set(key, Number(e.target.value) as 6 | 8 | 10)
                    }
                  >
                    {[6, 8, 10].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                ) : key === "defaultIncoterm" ? (
                  <select
                    aria-label={labels[key]}
                    value={values.defaultIncoterm}
                    onChange={(e) =>
                      set(
                        key,
                        e.target.value as WorkspaceSettings["defaultIncoterm"],
                      )
                    }
                  >
                    {[
                      "EXW",
                      "FCA",
                      "CPT",
                      "CIP",
                      "DAP",
                      "DPU",
                      "DDP",
                      "FAS",
                      "FOB",
                      "CFR",
                      "CIF",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={labels[key]}
                    type={key.endsWith("Color") ? "color" : "text"}
                    value={String(values[key])}
                    onChange={(e) =>
                      set(key, e.target.value as WorkspaceSettings[typeof key])
                    }
                  />
                )}
              </fieldset>
              <div className="setting-actions">
                <button
                  className="text-button"
                  disabled={
                    locked ||
                    !(key in overrides) ||
                    (key === "customFields" &&
                      !settings.values.customFields.every((field) =>
                        settings.inheritedValues.customFields.some(
                          (inherited) =>
                            inherited.key === field.key &&
                            inherited.type === field.type,
                        ),
                      ))
                  }
                  onClick={() => reset(key)}
                >
                  <RotateCcw size={12} />
                  Reset to inherited
                </button>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={locks.includes(key)}
                    onChange={(e) =>
                      setLocks((old) =>
                        e.target.checked
                          ? [...old, key]
                          : old.filter((k) => k !== key),
                      )
                    }
                  />
                  Lock for lower levels
                </label>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
