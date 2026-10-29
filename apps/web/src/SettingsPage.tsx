import { useState, useRef, useEffect, useMemo } from "react";
import {
  LockKeyhole,
  RotateCcw,
  Building2,
  Globe2,
  FileText,
  Palette,
  SlidersHorizontal,
  Check,
  Save,
} from "lucide-react";
import {
  type SettingKey,
  type WorkspaceSettings,
  type SettingsView,
  type TenantAccess,
} from "@freightnaut/domain";
import type { ApiClient } from "./api";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { PageHeader } from "./ui";
import { countryOptions } from "./countries";
import { useNavigationGuard } from "./navigation";
const groups = [
  {
    id: "company",
    name: "Company profile",
    icon: Building2,
    title: "Your exporter details",
    description: "Save the details you use on every shipment.",
    keys: ["exporter"],
  },
  {
    id: "regional",
    name: "Regional & trade",
    icon: Globe2,
    title: "Your regional and trade defaults",
    description:
      "Use the formats, currencies and trade details your team works with.",
    keys: [
      "locale",
      "timeZone",
      "defaultCurrency",
      "originCountry",
      "destinationCountry",
      "defaultIncoterm",
      "defaultUnit",
      "packageLabel",
    ],
  },
  {
    id: "documents",
    name: "Document preferences",
    icon: FileText,
    title: "Make your documents your own",
    description: "Set titles, declarations and the checks your team needs.",
    keys: [
      "documentTitles",
      "secondaryTitles",
      "declaration",
      "buyerPoRequired",
      "hsCodeDigits",
    ],
  },
  {
    id: "branding",
    name: "Branding",
    icon: Palette,
    title: "A workspace that feels like yours",
    description:
      "Your name and colors appear throughout the workspace and documents.",
    keys: ["brandName", "primaryColor", "accentColor"],
  },
  {
    id: "fields",
    name: "Custom fields",
    icon: SlidersHorizontal,
    title: "Capture what your business needs",
    description:
      "Add fields once. They appear in shipment forms, checks and documents.",
    keys: ["customFields"],
  },
];
const labels: Record<SettingKey, string> = {
  customFields: "Custom shipment fields",
  brandName: "Brand name",
  primaryColor: "Primary color",
  accentColor: "Accent color",
  locale: "Number and date format",
  timeZone: "Workspace time zone",
  defaultCurrency: "Default currency",
  originCountry: "Default origin country",
  destinationCountry: "Default destination country",
  defaultIncoterm: "Default Incoterm",
  exporter: "Exporter profile",
  packageLabel: "Package label",
  defaultUnit: "Default goods unit",
  hsCodeDigits: "HS code length",
  buyerPoRequired: "Buyer PO reference",
  declaration: "Document declaration",
  documentTitles: "Document titles",
  secondaryTitles: "Secondary document titles",
};
const help: Partial<Record<SettingKey, string>> = {
  exporter:
    "Your legal company name, address and tax identifier. New shipments use these details automatically.",
  locale: "Controls how numbers and dates are displayed.",
  timeZone: "Dates are shown in this time zone.",
  defaultCurrency:
    "Applied to new shipments. You can change it on each shipment.",
  originCountry: "Preselected when you start a new shipment.",
  destinationCountry: "Preselected when you start a new shipment.",
  defaultIncoterm: "Your usual delivery term.",
  defaultUnit: "For example PCS, KG or SET.",
  packageLabel: "For example cartons, pallets or packages.",
  documentTitles: "The main heading printed on each document.",
  secondaryTitles: "Optional headings in a second language.",
  declaration: "Your standard declaration or terms. Leave blank if not needed.",
  buyerPoRequired:
    "Require a buyer order reference before a shipment passes your checks.",
  hsCodeDigits: "The number of digits required by your workspace checks.",
  brandName: "The name shown in your workspace and document footer.",
  primaryColor: "Used for the brand mark and document ink.",
  accentColor: "Used for primary actions and selected items.",
};
export function SettingsPage({
  tenant,
  settings,
  api,
  onSaved,
  initialSection = "company",
  onSectionChange,
}: {
  tenant: TenantAccess;
  settings: SettingsView;
  api: ApiClient;
  onSaved: (view: SettingsView) => void;
  initialSection?: string;
  onSectionChange?: (section: string) => void;
}) {
  const initialOverrides = () =>
    Object.fromEntries(
      Object.entries(settings.overrides).filter(
        ([key]) =>
          !settings.provenance[key].lockedBy ||
          settings.provenance[key].lockedBy === tenant.kind,
      ),
    );
  const [overrides, setOverrides] =
      useState<Partial<WorkspaceSettings>>(initialOverrides),
    [locks, setLocks] = useState(settings.locks),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [section, setSection] = useState(
      groups.some((group) => group.id === initialSection)
        ? initialSection
        : "company",
    );
  const baseline = useRef(
      JSON.stringify({ overrides: initialOverrides(), locks: settings.locks }),
    ),
    dirty = JSON.stringify({ overrides, locks }) !== baseline.current,
    dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const registerGuard = useNavigationGuard();
  useEffect(
    () =>
      registerGuard(async () => {
        if (dirtyRef.current)
          throw new Error(
            "Save your settings or discard the unsaved changes before leaving this page.",
          );
      }),
    [registerGuard],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const values = { ...settings.inheritedValues, ...overrides },
    countries = useMemo(() => countryOptions(values.locale), [values.locale]);
  const active = groups.find((group) => group.id === section)!;
  function set<K extends SettingKey>(key: K, value: WorkspaceSettings[K]) {
    setOverrides((old) => ({ ...old, [key]: value }));
  }
  function reset(key: SettingKey) {
    setOverrides((old) => {
      const next = { ...old };
      delete next[key];
      return next;
    });
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      const next = await api<SettingsView>(
        `/api/tenants/${tenant.id}/settings`,
        {
          method: "PUT",
          body: JSON.stringify({
            revision: settings.revision,
            overrides,
            locks,
          }),
        },
      );
      dirtyRef.current = false;
      onSaved(next);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save your settings.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Workspace settings"
        description={`Defaults and preferences for ${tenant.name}.`}
        actions={
          <button
            className="primary"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            <Save size={16} />
            {saving ? "Saving…" : "Save settings"}
          </button>
        }
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {groups.map((group) => (
            <button
              key={group.id}
              className={section === group.id ? "selected" : ""}
              onClick={() => {
                setSection(group.id);
                onSectionChange?.(group.id);
              }}
              aria-current={section === group.id ? "page" : undefined}
            >
              <group.icon size={18} />
              {group.name}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <div className="settings-section-heading">
            <h2>{active.title}</h2>
            <p>{active.description}</p>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {section === "branding" && (
            <div className="brand-preview">
              <span style={{ background: values.primaryColor }}>F</span>
              <div>
                <strong>{values.brandName}</strong>
                <small>Workspace appearance</small>
              </div>
              <span
                className="preview-button"
                style={{
                  background: values.accentColor,
                  color: accentText(values.accentColor),
                }}
              >
                Primary action
              </span>
            </div>
          )}
          <div className="settings-panel">
            {(active.keys as SettingKey[]).map((key) => {
              const source = settings.provenance[key],
                locked = !!source.lockedBy && source.lockedBy !== tenant.kind,
                nested =
                  key === "exporter" ||
                  key === "documentTitles" ||
                  key === "secondaryTitles";
              return (
                <section
                  className={
                    "setting-row" +
                    (key === "customFields" ? " setting-row-wide" : "")
                  }
                  key={key}
                >
                  <div className="setting-description">
                    <strong>{labels[key]}</strong>
                    {help[key] && <p>{help[key]}</p>}
                    <span
                      className={
                        "source-badge" + (locked ? " source-locked" : "")
                      }
                    >
                      {locked ? (
                        <>
                          <LockKeyhole size={11} />
                          Locked by {source.lockedBy}
                        </>
                      ) : key in overrides ? (
                        "Customized"
                      ) : (
                        `Inherited from ${source.source}`
                      )}
                    </span>
                  </div>
                  <div className="setting-value">
                    <fieldset className="editor-fields" disabled={locked}>
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
                          {Object.entries(values[key]).map(
                            ([nestedKey, value]) => (
                              <label key={nestedKey}>
                                {nestedKey === "taxId"
                                  ? "Tax identifier"
                                  : nestedKey === "packing-list"
                                    ? "Packing list"
                                    : nestedKey === "invoice"
                                      ? "Commercial invoice"
                                      : nestedKey === "name"
                                        ? "Legal company name"
                                        : "Registered address"}
                                {nestedKey === "address" ? (
                                  <textarea
                                    rows={3}
                                    value={value}
                                    onChange={(event) =>
                                      set(key, {
                                        ...values[key],
                                        [nestedKey]: event.target.value,
                                      } as WorkspaceSettings[typeof key])
                                    }
                                  />
                                ) : (
                                  <input
                                    value={value}
                                    placeholder={
                                      nestedKey === "name"
                                        ? "Your company’s legal name"
                                        : undefined
                                    }
                                    onChange={(event) =>
                                      set(key, {
                                        ...values[key],
                                        [nestedKey]: event.target.value,
                                      } as WorkspaceSettings[typeof key])
                                    }
                                  />
                                )}
                              </label>
                            ),
                          )}
                        </div>
                      ) : key === "buyerPoRequired" ? (
                        <label className="checkbox-label switch-label">
                          <input
                            type="checkbox"
                            checked={values.buyerPoRequired}
                            onChange={(event) => set(key, event.target.checked)}
                          />
                          <span>Require buyer PO reference</span>
                        </label>
                      ) : key === "declaration" ? (
                        <textarea
                          aria-label={labels[key]}
                          rows={5}
                          placeholder="Your standard declaration…"
                          value={values.declaration}
                          onChange={(event) => set(key, event.target.value)}
                        />
                      ) : key === "defaultCurrency" ? (
                        <select
                          aria-label={labels[key]}
                          value={values.defaultCurrency}
                          onChange={(event) => set(key, event.target.value)}
                        >
                          {Intl.supportedValuesOf("currency").map(
                            (currency) => (
                              <option key={currency}>{currency}</option>
                            ),
                          )}
                        </select>
                      ) : key === "timeZone" ? (
                        <select
                          aria-label={labels[key]}
                          value={values.timeZone}
                          onChange={(event) => set(key, event.target.value)}
                        >
                          {Array.from(
                            new Set([
                              "UTC",
                              values.timeZone,
                              ...Intl.supportedValuesOf("timeZone"),
                            ]),
                          ).map((zone) => (
                            <option key={zone}>{zone}</option>
                          ))}
                        </select>
                      ) : key === "originCountry" ||
                        key === "destinationCountry" ? (
                        <select
                          aria-label={labels[key]}
                          value={values[key]}
                          onChange={(event) => set(key, event.target.value)}
                        >
                          <option value="">Choose a country</option>
                          {countries.map((country) => (
                            <option key={country.code} value={country.code}>
                              {country.name} ({country.code})
                            </option>
                          ))}
                        </select>
                      ) : key === "hsCodeDigits" ? (
                        <select
                          aria-label={labels[key]}
                          value={values.hsCodeDigits}
                          onChange={(event) =>
                            set(key, Number(event.target.value) as 6 | 8 | 10)
                          }
                        >
                          {[6, 8, 10].map((digits) => (
                            <option key={digits} value={digits}>
                              {digits} digits
                            </option>
                          ))}
                        </select>
                      ) : key === "defaultIncoterm" ? (
                        <select
                          aria-label={labels[key]}
                          value={values.defaultIncoterm}
                          onChange={(event) =>
                            set(
                              key,
                              event.target
                                .value as WorkspaceSettings["defaultIncoterm"],
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
                          ].map((term) => (
                            <option key={term}>{term}</option>
                          ))}
                        </select>
                      ) : key === "primaryColor" || key === "accentColor" ? (
                        <div className="color-control">
                          <input
                            aria-label={labels[key] + " picker"}
                            type="color"
                            value={
                              /^#[0-9a-f]{6}$/i.test(values[key])
                                ? values[key]
                                : "#000000"
                            }
                            onChange={(event) => set(key, event.target.value)}
                          />
                          <input
                            aria-label={labels[key]}
                            value={values[key]}
                            onChange={(event) => set(key, event.target.value)}
                          />
                        </div>
                      ) : (
                        <input
                          aria-label={labels[key]}
                          value={String(values[key])}
                          onChange={(event) =>
                            set(
                              key,
                              event.target
                                .value as WorkspaceSettings[typeof key],
                            )
                          }
                        />
                      )}
                    </fieldset>
                    {key === "locale" && (
                      <p className="field-hint">
                        Example: {safeExample(values.locale)}
                      </p>
                    )}
                    <details className="setting-advanced">
                      <summary>Inheritance & controls</summary>
                      <div className="setting-actions">
                        <button
                          className="text-button"
                          disabled={
                            locked ||
                            !(key in overrides) ||
                            (key === "customFields" &&
                              !settings.values.customFields.every((field) =>
                                settings.inheritedValues.customFields.some(
                                  (parent) =>
                                    parent.key === field.key &&
                                    parent.type === field.type,
                                ),
                              ))
                          }
                          onClick={() => reset(key)}
                        >
                          <RotateCcw size={13} />
                          Use inherited value
                        </button>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={locks.includes(key)}
                            disabled={locked}
                            onChange={(event) =>
                              setLocks((old) =>
                                event.target.checked
                                  ? [...old, key]
                                  : old.filter((item) => item !== key),
                              )
                            }
                          />
                          Lock for lower levels
                        </label>
                      </div>
                    </details>
                  </div>
                </section>
              );
            })}
          </div>
          <div className="settings-savebar">
            <span>
              {dirty ? (
                "You have unsaved changes."
              ) : (
                <>
                  <Check size={15} />
                  All changes saved
                </>
              )}
            </span>
            {dirty && (
              <button
                className="secondary"
                onClick={() => {
                  setOverrides(initialOverrides());
                  setLocks(settings.locks);
                  setError("");
                }}
              >
                Discard changes
              </button>
            )}
            <button
              className="primary"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
function safeExample(locale: string) {
  try {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(
      123456.78,
    );
  } catch {
    return "Enter a valid locale, for example en-GB.";
  }
}
export function accentText(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "#102b4e";
  const channels = [1, 3, 5]
    .map((index) => parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.3
    ? "#102b4e"
    : luminance > 0.179
      ? "#000000"
      : "#ffffff";
}
