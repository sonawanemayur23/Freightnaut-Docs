import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  FileText,
  Package,
  Plus,
  Search,
  Ship,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Settings,
  Layers,
  BookOpen,
} from "lucide-react";
import {
  sampleShipment,
  shipmentSchema,
  validateShipment,
  renderDocument,
  totalAmount,
  money,
  type Shipment,
  type DocumentType,
} from "@freightnaut/domain";
import "./style.css";
const steps = [
  "Parties",
  "Goods & packages",
  "Terms & transport",
  "Review documents",
];
function load(): Shipment {
  try {
    const value = localStorage.getItem("freightnaut-draft");
    if (value) {
      const parsed = shipmentSchema.safeParse(JSON.parse(value));
      if (parsed.success) return parsed.data;
    }
  } catch {}
  return structuredClone(sampleShipment);
}
function DocumentPreview({
  shipment,
  type,
}: {
  shipment: Shipment;
  type: DocumentType;
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
        srcDoc={renderDocument(shipment, type)}
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}
function App() {
  const [shipment, setShipment] = useState<Shipment>(load);
  const [step, setStep] = useState(1);
  const [doc, setDoc] = useState<DocumentType>("invoice");
  const [save, setSave] = useState("Saved on this device");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const issues = validateShipment(shipment);
  const blockers = issues.filter((i) => i.severity === "blocker");
  useEffect(() => {
    try {
      localStorage.setItem("freightnaut-draft", JSON.stringify(shipment));
      setSave("Saved on this device");
    } catch {
      setSave("Not saved · browser storage unavailable");
    }
  }, [shipment]);
  function patch<K extends keyof Shipment>(key: K, value: Shipment[K]) {
    setShipment((s) => ({ ...s, [key]: value }));
  }
  function updateItem(index: number, key: string, value: string | number) {
    setShipment((s) => ({
      ...s,
      items: s.items.map((i, n) => (n === index ? { ...i, [key]: value } : i)),
    }));
  }
  async function download() {
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(`/api/documents/${doc}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shipment),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Could not generate the PDF.");
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = doc + "-draft.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "PDF download failed. Check the API is running.",
      );
    } finally {
      setDownloading(false);
    }
  }
  const field = (
    label: string,
    key: "buyerPo" | "date" | "portOfLoading" | "portOfDischarge",
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
      <div className="test-banner">
        <span>TEST WORKSPACE</span> Explore with sample data. All PDFs are
        marked as drafts.
      </div>
      <header className="topbar">
        <div className="brand">
          <b>
            F<span>•</span>
          </b>
          <strong>
            Freightnaut <em>Docs</em>
          </strong>
        </div>
        <div className="account">
          <span className="avatar">DA</span>
          <strong>Deccan Auto Components</strong>
          <ChevronDown size={16} />
        </div>
        <div className="top-context">
          <span className="dot" /> Local pilot{" "}
          <span className="divider">/</span> India → UAE
        </div>
        <span className="profile">PK</span>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="workspace-label">WORKSPACE</div>
          <div className="nav muted">
            <Layers size={18} /> Overview <span className="soon">Soon</span>
          </div>
          <div className="nav active">
            <Ship size={18} /> Shipments <span>1</span>
          </div>
          <div className="nav muted">
            <FileText size={18} /> Document sets
          </div>
          <div className="workspace-label second">MANAGE</div>
          <div className="nav muted">
            <BookOpen size={18} /> Master data
          </div>
          <div className="nav muted">
            <Settings size={18} /> Templates & rules
          </div>
          <div className="sidebar-bottom">
            <div className="pilot-icon">↗</div>
            <strong>Your first document set</strong>
            <p>
              One shipment. Consistent data.
              <br />
              Every document in sync.
            </p>
            <div className="pilot-tag">PILOT · v0.1</div>
          </div>
        </aside>
        <main>
          <div className="breadcrumb">
            Shipments <span>/</span> {shipment.id}
          </div>
          <div className="page-heading">
            <div>
              <div className="eyebrow">EXPORT DOCUMENT WORKSPACE</div>
              <h1>Let’s get this shipment ready.</h1>
              <p>
                Enter your shipment once. Build every document from the same
                details.
              </p>
            </div>
            <span className="draft-pill">● Draft</span>
          </div>
          <div className="shipment-strip">
            <div>
              <span className="flag">IN</span>
              <strong>India</strong>
              <ArrowRight size={16} />
              <span className="flag">AE</span>
              <strong>United Arab Emirates</strong>
            </div>
            <span className="chip">Commercial invoice</span>
            <span className="chip">Packing list</span>
            <div className="save">
              <Check size={14} />
              {save}
            </div>
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
              {step === 0 && (
                <div className="party-forms">
                  {(["exporter", "consignee"] as const).map((key) => (
                    <section className="subcard" key={key}>
                      <h3>
                        {key === "exporter" ? "Exporter" : "Buyer / consignee"}
                        <span>{key === "exporter" ? "INDIA" : "UAE"}</span>
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
                    <span>All values in USD</span>
                  </div>
                  <div className="table-scroll">
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
                                  updateItem(
                                    index,
                                    "description",
                                    e.target.value,
                                  )
                                }
                              />
                              <small>Country of origin · India</small>
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
                                    /^\d{0,12}(\.\d{0,4})?$/.test(
                                      e.target.value,
                                    )
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
                              {money(
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
                                    shipment.items.filter(
                                      (_, i) => i !== index,
                                    ),
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
                          unit: "PCS",
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
                      <small>USD</small> {money(totalAmount(shipment))}
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
                          ? "Total cartons"
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
                  {field("Shipment date", "date")}
                  {field("Buyer PO reference", "buyerPo")}
                  <label>
                    Incoterm
                    <select
                      value={shipment.incoterm}
                      onChange={(e) =>
                        patch(
                          "incoterm",
                          e.target.value as Shipment["incoterm"],
                        )
                      }
                    >
                      <option>CIF</option>
                      <option>FOB</option>
                      <option>EXW</option>
                    </select>
                  </label>
                  <label>
                    Currency
                    <input readOnly value="USD · US Dollar" />
                  </label>
                  {field("Port of loading", "portOfLoading")}
                  {field("Port of discharge", "portOfDischarge")}
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
                          : "Pilot data checks passed"}
                      </strong>
                      <p>
                        These checks cover this pilot’s data requirements. Trade
                        compliance review is still required.
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
                            : issue.field === "buyerPo"
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
                    disabled={downloading}
                    onClick={download}
                  >
                    <Download size={16} />
                    {downloading ? "Preparing PDF…" : "Download selected draft"}
                  </button>
                </div>
              )}
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              <div className="form-footer">
                <span>Changes save automatically in this browser.</span>
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
                  disabled={downloading}
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
                <span>EN + AR</span>
              </div>
              <DocumentPreview shipment={shipment} type={doc} />
              <div className="preview-caption">
                <span>A4 · Portrait</span>
                <span>Draft template v0.1</span>
              </div>
              <div className="check-summary">
                <span
                  className={blockers.length ? "warning-dot" : "live-dot"}
                />
                {blockers.length
                  ? `${blockers.length} blockers to review`
                  : "Data checks passed"}
                <button onClick={() => setStep(3)}>
                  Review checks <ArrowRight size={12} />
                </button>
              </div>
            </aside>
          </div>
          <div className="bottom-note">
            <span>FREIGHTNAUT DOCS</span> Built for the details that move trade.
          </div>
        </main>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
