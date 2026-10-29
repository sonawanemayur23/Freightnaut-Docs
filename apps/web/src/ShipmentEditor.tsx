import { useState, useEffect, useRef } from "react";
import { CustomFields } from "./CustomFields";
import {
  ArrowRight,
  Check,
  Download,
  FileText,
  Package,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  shipmentSchema,
  renderDocument,
  totalAmount,
  money,
  validateShipment,
  type Shipment,
  type DocumentType,
  type WorkspaceSettings,
} from "@freightnaut/domain";
import { ApiError, type ApiClient } from "./api";
export function countryName(code: string, locale: string) {
  if (!code) return "Not set";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}
const currencies = Intl.supportedValuesOf("currency");
const incoterms = shipmentSchema.shape.incoterm.options;
const steps = [
  "Parties",
  "Goods & packages",
  "Terms & transport",
  "Review documents",
];
function DocumentPreview({
  shipment,
  type,
  settings,
}: {
  shipment: Shipment;
  type: DocumentType;
  settings: WorkspaceSettings;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / 794),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={container}
      className="preview-canvas"
      style={{ height: 1123 * scale }}
    >
      <iframe
        title={
          type === "invoice"
            ? "Commercial invoice preview"
            : "Packing list preview"
        }
        sandbox=""
        srcDoc={renderDocument(shipment, type, settings)}
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}

export function ShipmentEditor({
  initial,
  tenantId,
  settings,
  api,
  canWrite,
  canDownload,
  onBack,
}: {
  initial: { id: string; data: Shipment; version: number };
  tenantId: string;
  settings: WorkspaceSettings;
  api: ApiClient;
  canWrite: boolean;
  canDownload: boolean;
  onBack: () => void;
}) {
  const [shipment, setShipment] = useState(initial.data),
    [step, setStep] = useState(canWrite ? 0 : 3),
    [doc, setDoc] = useState<DocumentType>("invoice");
  const [save, setSave] = useState("Saved"),
    [error, setError] = useState(""),
    [downloading, setDownloading] = useState(false);
  const latest = useRef(shipment),
    saved = useRef(JSON.stringify(initial.data)),
    version = useRef(initial.version),
    pending = useRef<Promise<void> | null>(null),
    blocked = useRef(false),
    mounted = useRef(true);
  latest.current = shipment;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const path = `/api/tenants/${tenantId}/shipments/${initial.id}`;
  async function flush(): Promise<void> {
    if (!canWrite) return;
    if (blocked.current)
      throw new Error(
        "Saving is blocked. Reload this shipment to resolve the conflict; copy any unsaved changes first.",
      );
    if (pending.current) {
      await pending.current;
      return flush();
    }
    const snapshot = latest.current,
      serialized = JSON.stringify(snapshot);
    if (serialized === saved.current) return;
    setSave("Saving…");
    const operation = (async () => {
      try {
        const result = await api<{ version: number }>(path, {
          method: "PUT",
          body: JSON.stringify({ version: version.current, data: snapshot }),
        });
        version.current = result.version;
        saved.current = serialized;
        if (mounted.current) {
          setSave(
            JSON.stringify(latest.current) === serialized
              ? "Saved"
              : "Unsaved changes",
          );
          setError("");
        }
      } catch (error) {
        blocked.current = error instanceof ApiError && error.status === 409;
        if (mounted.current) {
          setSave("Not saved");
          setError(
            error instanceof Error ? error.message : "Could not save changes.",
          );
        }
        throw error;
      }
    })();
    pending.current = operation;
    try {
      await operation;
    } finally {
      pending.current = null;
    }
    if (JSON.stringify(latest.current) !== saved.current) return flush();
  }
  useEffect(() => {
    if (!canWrite || JSON.stringify(shipment) === saved.current) return;
    setSave("Unsaved changes");
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [shipment]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== saved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  function patch<K extends keyof Shipment>(key: K, value: Shipment[K]) {
    if (canWrite) setShipment((s) => ({ ...s, [key]: value }));
  }
  function updateItem(index: number, key: string, value: string | number) {
    if (canWrite)
      setShipment((s) => ({
        ...s,
        items: s.items.map((item, i) =>
          i === index ? { ...item, [key]: value } : item,
        ),
      }));
  }
  async function download() {
    setDownloading(true);
    setError("");
    try {
      await flush();
      const blob = await api<Blob>(
        path + `/documents/${doc}/pdf`,
        { method: "POST", body: JSON.stringify({ version: version.current }) },
        true,
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = doc + "-draft.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not download the document.",
      );
    } finally {
      setDownloading(false);
    }
  }
  const issues = validateShipment(shipment, settings),
    blockers = issues.filter((i) => i.severity === "blocker");
  const formatMoney = (value: string) =>
    money(value, settings.locale, shipment.currency);
  const field = (
    label: string,
    key: "id" | "date" | "buyerPo" | "portOfLoading" | "portOfDischarge",
  ) => (
    <label>
      {label}
      <input
        id={key}
        type={key === "date" ? "date" : "text"}
        value={shipment[key]}
        onChange={(e) => patch(key, e.target.value)}
      />
    </label>
  );
  return (
    <>
      <div className="editor-toolbar">
        <button
          className="secondary"
          onClick={() => {
            void flush()
              .then(onBack)
              .catch((e) => setError(e.message));
          }}
        >
          ← Shipments
        </button>
        <span>{canWrite ? save : "Read-only access"}</span>
        <span>
          {countryName(shipment.originCountry, settings.locale)} →{" "}
          {countryName(shipment.destinationCountry, settings.locale)}
        </span>
        <strong>{shipment.id || "Untitled shipment"}</strong>
      </div>
      <div className="stepper">
        {steps.map((name, i) => (
          <button
            key={name}
            onClick={() => setStep(i)}
            className={step === i ? "selected" : step > i ? "complete" : ""}
          >
            <span>{step > i ? <Check size={14} /> : i + 1}</span>
            {name}
            {i < 3 && <i />}
          </button>
        ))}
      </div>
      <div className="work-area">
        <section className="form-panel">
          <div className="section-heading">
            <div>
              <h2>{steps[step]}</h2>
              <p>
                {
                  [
                    "Who is sending and receiving this shipment?",
                    "Add your goods, then confirm package totals.",
                    "Set the references and delivery terms.",
                    "Check the details before downloading a draft.",
                  ][step]
                }
              </p>
            </div>
            <span className="step-count">0{step + 1} / 04</span>
          </div>
          <fieldset
            className="editor-fields"
            disabled={!canWrite && step !== 3}
          >
            {step === 0 && (
              <div className="party-forms">
                {(["exporter", "consignee"] as const).map((key) => (
                  <section className="subcard" key={key}>
                    <h3>
                      {key === "exporter" ? "Exporter" : "Buyer / consignee"}
                      <span>
                        {countryName(
                          key === "exporter"
                            ? shipment.originCountry
                            : shipment.destinationCountry,
                          settings.locale,
                        )}
                      </span>
                    </h3>
                    {(["name", "address", "taxId"] as const).map((k) => (
                      <label key={k}>
                        {k === "taxId"
                          ? "Tax identifier"
                          : k === "name"
                            ? "Legal name"
                            : "Address"}
                        <input
                          id={key + "." + k}
                          value={shipment[key][k]}
                          onChange={(e) =>
                            patch(key, {
                              ...shipment[key],
                              [k]: e.target.value,
                            })
                          }
                        />
                      </label>
                    ))}
                  </section>
                ))}
              </div>
            )}
            {step === 1 && (
              <>
                <div className="table-toolbar">
                  <strong>
                    Goods <span>{shipment.items.length} lines</span>
                  </strong>
                  <span>All values in {shipment.currency}</span>
                </div>
                <div className="table-scroll" id="items" tabIndex={-1}>
                  <table className="goods">
                    <thead>
                      <tr>
                        <th className="item-col">PRODUCT / DESCRIPTION</th>
                        <th>HS CODE</th>
                        <th>QTY</th>
                        <th>UNIT PRICE</th>
                        <th className="right">AMOUNT</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {shipment.items.map((item, index) => (
                        <tr key={item.id}>
                          <td>
                            <div className="item-number">
                              {String(index + 1).padStart(2, "0")}
                            </div>
                            <input
                              aria-label={"Description line " + (index + 1)}
                              id={`items.${index}.description`}
                              value={item.description}
                              onChange={(e) =>
                                updateItem(index, "description", e.target.value)
                              }
                            />
                            <small>
                              Country of origin ·{" "}
                              {countryName(
                                shipment.originCountry,
                                settings.locale,
                              )}
                            </small>
                          </td>
                          <td>
                            <input
                              aria-label={"HS code line " + (index + 1)}
                              id={`items.${index}.hsCode`}
                              value={item.hsCode}
                              onChange={(e) =>
                                updateItem(index, "hsCode", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              aria-label={"Quantity line " + (index + 1)}
                              id={`items.${index}.quantity`}
                              type="number"
                              min="0"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  "quantity",
                                  Number(e.target.value),
                                )
                              }
                            />
                            <small>{item.unit}</small>
                          </td>
                          <td>
                            <input
                              aria-label={"Unit price line " + (index + 1)}
                              value={item.unitPrice}
                              onChange={(e) => {
                                if (
                                  /^\d{0,12}(\.\d{0,4})?$/.test(e.target.value)
                                )
                                  updateItem(
                                    index,
                                    "unitPrice",
                                    e.target.value === "."
                                      ? "0."
                                      : e.target.value || "0",
                                  );
                              }}
                            />
                          </td>
                          <td className="right amount">
                            {formatMoney(
                              totalAmount({ ...shipment, items: [item] }),
                            )}
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={"Remove line " + (index + 1)}
                              onClick={() =>
                                patch(
                                  "items",
                                  shipment.items.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="add-line"
                  onClick={() =>
                    patch("items", [
                      ...shipment.items,
                      {
                        id: crypto.randomUUID(),
                        description: "",
                        hsCode: "",
                        quantity: 1,
                        unit: settings.defaultUnit,
                        unitPrice: "0.00",
                      },
                    ])
                  }
                >
                  <Plus size={16} /> Add goods line
                </button>
                <div className="total-row">
                  <span>SHIPMENT VALUE</span>
                  <strong>
                    <small>{shipment.currency}</small>{" "}
                    {formatMoney(totalAmount(shipment))}
                  </strong>
                </div>
                <div className="package-header">
                  <Package size={18} />
                  <h3>Packages & weight</h3>
                  <span>Used across both documents</span>
                </div>
                <div className="package-fields">
                  {(["packages", "netKg", "grossKg"] as const).map((key) => (
                    <label key={key}>
                      {key === "packages"
                        ? "Total " + settings.packageLabel
                        : key === "netKg"
                          ? "Net weight (kg)"
                          : "Gross weight (kg)"}
                      <input
                        id={key}
                        type="number"
                        min="0"
                        value={shipment[key]}
                        onChange={(e) => patch(key, Number(e.target.value))}
                      />
                    </label>
                  ))}
                </div>
                <div className="hint">
                  <CheckCircle2 size={16} />
                  <span>
                    One source of truth. Goods and package totals stay in sync
                    across your invoice and packing list.
                  </span>
                </div>
              </>
            )}
            {step === 2 && (
              <div className="terms-fields">
                {field("Shipment reference", "id")}
                {field("Shipment date", "date")}
                <label>
                  Origin country (ISO code)
                  <input
                    id="originCountry"
                    value={shipment.originCountry}
                    maxLength={2}
                    onChange={(e) =>
                      patch("originCountry", e.target.value.toUpperCase())
                    }
                  />
                </label>
                <label>
                  Destination country (ISO code)
                  <input
                    id="destinationCountry"
                    value={shipment.destinationCountry}
                    maxLength={2}
                    onChange={(e) =>
                      patch("destinationCountry", e.target.value.toUpperCase())
                    }
                  />
                </label>
                {field("Buyer PO reference", "buyerPo")}
                <label>
                  Incoterm
                  <select
                    value={shipment.incoterm}
                    onChange={(e) =>
                      patch("incoterm", e.target.value as Shipment["incoterm"])
                    }
                  >
                    {incoterms.map((term) => (
                      <option key={term}>{term}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Currency
                  <select
                    value={shipment.currency}
                    onChange={(e) => patch("currency", e.target.value)}
                  >
                    {currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {field("Port of loading", "portOfLoading")}
                {field("Port of discharge", "portOfDischarge")}
                <CustomFields
                  fields={settings.customFields}
                  values={shipment.custom}
                  onChange={(values) => patch("custom", values)}
                />
              </div>
            )}
            {step === 3 && (
              <div className="review">
                <div
                  className={
                    blockers.length
                      ? "review-status has-issues"
                      : "review-status"
                  }
                >
                  <CheckCircle2 />
                  <div>
                    <strong>
                      {blockers.length
                        ? `${blockers.length} things to fix`
                        : "Data checks passed"}
                    </strong>
                    <p>
                      These checks cover your workspace’s data requirements.
                      Trade compliance review is still required.
                    </p>
                  </div>
                </div>
                {issues.map((issue) => (
                  <button
                    className="issue"
                    key={issue.id}
                    onClick={() => {
                      const target =
                        issue.field.startsWith("items") ||
                        ["packages", "grossKg"].includes(issue.field)
                          ? 1
                          : issue.field === "buyerPo" ||
                              issue.field.startsWith("custom.") ||
                              issue.field === "originCountry" ||
                              issue.field === "destinationCountry"
                            ? 2
                            : 0;
                      setStep(target);
                      setTimeout(
                        () => document.getElementById(issue.field)?.focus(),
                        50,
                      );
                    }}
                  >
                    <AlertCircle size={16} />
                    <span>
                      <b>{issue.severity}</b>
                      {issue.message}
                      <small>{issue.source}</small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
                <div className="subcard">
                  <h3>Included in this set</h3>
                  <p>Commercial invoice · Packing list</p>
                  <p>Both use the shipment data shown in this workspace.</p>
                </div>
                <button
                  className="primary"
                  disabled={downloading || !canDownload}
                  onClick={download}
                >
                  <Download size={16} />
                  {downloading ? "Preparing PDF…" : "Download selected draft"}
                </button>
              </div>
            )}
          </fieldset>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div className="form-footer">
            <span>Changes save to your workspace.</span>
            <button
              className="secondary"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
            {step < 3 && (
              <button className="primary" onClick={() => setStep(step + 1)}>
                Continue <ArrowRight size={15} />
              </button>
            )}
          </div>
        </section>
        <aside className="preview-panel">
          <div className="preview-heading">
            <div>
              <span className="live-dot" /> LIVE PREVIEW
            </div>
            <button
              className="icon-button"
              title="Download draft PDF"
              aria-label="Download draft PDF"
              disabled={downloading || !canDownload}
              onClick={download}
            >
              <Download size={17} />
            </button>
          </div>
          <div className="document-tabs">
            <button
              className={doc === "invoice" ? "current" : ""}
              onClick={() => setDoc("invoice")}
            >
              <FileText size={14} /> Invoice
            </button>
            <button
              className={doc === "packing-list" ? "current" : ""}
              onClick={() => setDoc("packing-list")}
            >
              <FileText size={14} /> Packing list
            </button>
            <span>{settings.locale}</span>
          </div>
          <DocumentPreview shipment={shipment} type={doc} settings={settings} />
          <div className="preview-caption">
            <span>A4 · Portrait</span>
            <span>Account template</span>
          </div>
          <div className="check-summary">
            <span className={blockers.length ? "warning-dot" : "live-dot"} />
            {blockers.length
              ? `${blockers.length} blockers to review`
              : "Data checks passed"}
            <button onClick={() => setStep(3)}>
              Review checks <ArrowRight size={12} />
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
