import { z } from "zod";
import Decimal from "decimal.js";
export const partySchema = z.object({
  name: z.string().max(300),
  address: z.string().max(1500),
  taxId: z.string().max(100),
});
export const shipmentSchema = z.object({
  id: z.string().min(1).max(100),
  date: z.iso.date(),
  buyerPo: z.string().max(100),
  exporter: partySchema,
  consignee: partySchema,
  currency: z.literal("USD"),
  incoterm: z.enum(["CIF", "FOB", "EXW"]),
  portOfLoading: z.string().max(100),
  portOfDischarge: z.string().max(100),
  packages: z.number().int().min(0).max(100000),
  netKg: z.number().min(0).max(100000000),
  grossKg: z.number().min(0).max(100000000),
  items: z
    .array(
      z.object({
        id: z.string(),
        description: z.string().max(2000),
        hsCode: z.string().max(20),
        quantity: z.number().min(0).max(100000000),
        unit: z.string().max(20),
        unitPrice: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
      }),
    )
    .max(500),
});
export type Shipment = z.infer<typeof shipmentSchema>;
export type DocumentType = "invoice" | "packing-list";
export type Issue = {
  id: string;
  severity: "blocker" | "warning";
  field: string;
  message: string;
  source: string;
};
export const sampleShipment: Shipment = {
  id: "DAC/EXP/26-27/0148",
  date: "2026-10-29",
  buyerPo: "AMAS-PO-77120",
  exporter: {
    name: "Deccan Auto Components Pvt Ltd",
    address: "Plot 42, MIDC Chakan Phase II, Pune 410501, Maharashtra, India",
    taxId: "27AAECD4821K1Z5",
  },
  consignee: {
    name: "Al Mansoori Auto Spares LLC",
    address:
      "Warehouse 14, Al Quoz Industrial Area 3, Dubai, United Arab Emirates",
    taxId: "100384729100003",
  },
  currency: "USD",
  incoterm: "CIF",
  portOfLoading: "Nhava Sheva · INNSA",
  portOfDischarge: "Jebel Ali · AEJEA",
  packages: 24,
  netKg: 1152,
  grossKg: 1240,
  items: [
    {
      id: "1",
      description: "Brake disc rotor, ventilated 280 mm",
      hsCode: "87083000",
      quantity: 960,
      unit: "PCS",
      unitPrice: "14.20",
    },
    {
      id: "2",
      description: "Clutch plate assembly 215 mm",
      hsCode: "87089300",
      quantity: 480,
      unit: "PCS",
      unitPrice: "21.50",
    },
  ],
};
export function lineAmount(item: Shipment["items"][number]): string {
  return new Decimal(item.unitPrice)
    .mul(item.quantity)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
export function totalAmount(s: Shipment): string {
  return s.items
    .reduce((sum, i) => sum.add(lineAmount(i)), new Decimal(0))
    .toFixed(2);
}
export function money(value: string): string {
  const [whole, fraction] = new Decimal(value).toFixed(2).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction;
}
export function validateShipment(s: Shipment): Issue[] {
  const issues: Issue[] = [];
  const add = (
    field: string,
    message: string,
    severity: Issue["severity"] = "blocker",
  ) =>
    issues.push({
      id: field,
      severity,
      field,
      message,
      source: "Pilot data checks · v0.1 (not a certified compliance pack)",
    });
  if (!s.exporter.name.trim())
    add("exporter.name", "Enter the exporter’s legal name.");
  if (!s.consignee.name.trim())
    add("consignee.name", "Enter the consignee’s legal name.");
  if (!s.buyerPo.trim())
    add(
      "buyerPo",
      "Add the buyer PO reference, or confirm it is not needed.",
      "warning",
    );
  if (!s.items.length) add("items", "Add at least one goods line.");
  s.items.forEach((item, index) => {
    const prefix = `items.${index}`;
    if (!item.description.trim())
      add(prefix + ".description", `Line ${index + 1}: enter a description.`);
    if (!/^\d{8}$/.test(item.hsCode))
      add(
        prefix + ".hsCode",
        `Line ${index + 1}: enter an 8-digit HS code for this pilot template.`,
      );
    if (item.quantity <= 0)
      add(
        prefix + ".quantity",
        `Line ${index + 1}: quantity must be greater than zero.`,
      );
  });
  if (s.grossKg < s.netKg)
    add("grossKg", "Gross weight must be at least the net weight.");
  if (s.packages < 1) add("packages", "Enter the number of packages.");
  return issues;
}
const escape = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderDocument(s: Shipment, type: DocumentType): string {
  const e = escape;
  const invoice = type === "invoice";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
 @page{size:A4;margin:16mm}@media screen{body{width:210mm;min-height:297mm;padding:16mm}}*{box-sizing:border-box}body{margin:0;color:#10213c;font:11px Arial,sans-serif;line-height:1.5}header{display:flex;justify-content:space-between;border-bottom:2px solid #10213c;padding-bottom:20px}header>div:first-child{max-width:55%}header>div:last-child{max-width:44%}h1{font-size:21px;margin:0}h2{font-size:12px;margin:0 0 5px}p{margin:2px 0}.muted{color:#64748b}.arabic{font-family:Arial,sans-serif;direction:rtl}.parties{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d5dce6;margin:20px 0}.box{padding:12px;overflow-wrap:anywhere}.box+.box{border-left:1px solid #d5dce6}table{border-collapse:collapse;width:100%;margin:18px 0;table-layout:fixed}thead{display:table-header-group}th{background:#0a2345;color:white;text-align:left;padding:8px;font-size:10px}td{padding:10px 8px;border-bottom:1px solid #d5dce6;overflow-wrap:anywhere}tr{break-inside:avoid}.number{text-align:right}.total{text-align:right;font-weight:bold;background:#f1f4f8;padding:12px}.summary{display:flex;justify-content:space-between;border:1px solid #d5dce6;padding:12px;margin:24px 0}.draft{position:fixed;top:40%;left:12%;font-size:100px;color:rgba(10,35,69,.045);transform:rotate(-35deg);z-index:-1}footer{margin-top:30px;border-top:1px solid #d5dce6;padding-top:10px;color:#64748b;font-size:9px}</style></head><body>
 <div class="draft">TEST DRAFT</div><header><div><h2>${e(s.exporter.name)}</h2><p>${e(s.exporter.address)}</p><p class="muted">Tax ID ${e(s.exporter.taxId)}</p></div><div style="text-align:right"><h1>${invoice ? "COMMERCIAL INVOICE" : "PACKING LIST"}</h1><h2 class="arabic" lang="ar">${invoice ? "فاتورة تجارية" : "قائمة التعبئة"}</h2><p>TEST · DRAFT</p></div></header>
 <section class="parties"><div class="box"><p class="muted">BUYER / CONSIGNEE · المشتري</p><h2>${e(s.consignee.name)}</h2><p>${e(s.consignee.address)}</p><p>TRN ${e(s.consignee.taxId) || "—"}</p></div><div class="box"><p>Shipment reference: <b>${e(s.id)}</b></p><p>Date: ${e(s.date)}</p><p>Buyer PO: ${e(s.buyerPo) || "—"}</p><p>Terms: ${e(s.incoterm)} ${e(s.portOfDischarge)}</p><p>Loading: ${e(s.portOfLoading)}</p></div></section>
 <table><thead><tr><th style="width:6%">#</th><th style="width:${invoice ? "36" : "50"}%">Description / الوصف</th><th style="width:16%">HS code</th><th>Qty</th><th>Unit</th>${invoice ? '<th>Price</th><th style="width:17%">Amount USD</th>' : ""}</tr></thead><tbody>${s.items.map((i, index) => `<tr><td>${index + 1}</td><td>${e(i.description)}</td><td>${e(i.hsCode)}</td><td class="number">${e(i.quantity)}</td><td>${e(i.unit)}</td>${invoice ? `<td class="number">${e(money(i.unitPrice))}</td><td class="number">${e(money(lineAmount(i)))}</td>` : ""}</tr>`).join("")}</tbody></table>
 ${invoice ? `<div class="total">Total (${e(s.currency)}) &nbsp; ${e(money(totalAmount(s)))}</div>` : ""}
 <section class="summary"><div>Packages<br><b>${e(s.packages)} cartons</b></div><div>Net weight<br><b>${e(s.netKg)} kg</b></div><div>Gross weight<br><b>${e(s.grossKg)} kg</b></div></section>
 <h2>Declaration</h2><p>This is a test draft for review. Confirm all shipment details before issuance.</p><footer>Freightnaut Docs · Pilot template v0.1 · TEST DATA · Not an issued document</footer></body></html>`;
}
