import { z } from "zod";
import Decimal from "decimal.js";
import {
  defaultSettings,
  customFieldKeySchema,
  type WorkspaceSettings,
} from "./settings.js";
export * from "./settings.js";
export * from "./access.js";
export const partySchema = z.object({
  name: z.string().max(300),
  address: z.string().max(1500),
  taxId: z.string().max(100),
});
export const shipmentSchema = z.strictObject({
  custom: z
    .record(
      customFieldKeySchema,
      z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
    )
    .refine((value) => Object.keys(value).length <= 100)
    .default({}),
  id: z.string().max(100),
  date: z.iso.date(),
  buyerPo: z.string().max(100),
  exporter: partySchema,
  consignee: partySchema,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine(
      (v) => Intl.supportedValuesOf("currency").includes(v),
      "Unknown ISO currency",
    ),
  originCountry: z.string().regex(/^([A-Z]{2})?$/),
  destinationCountry: z.string().regex(/^([A-Z]{2})?$/),
  incoterm: z.enum([
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
  ]),
  portOfLoading: z.string().max(100),
  portOfDischarge: z.string().max(100),
  packages: z.number().int().min(0).max(100000),
  netKg: z.number().min(0).max(100000000),
  grossKg: z.number().min(0).max(100000000),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
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
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits!;
}
export function lineAmount(
  item: Shipment["items"][number],
  currency = "USD",
): string {
  const digits = currencyDigits(currency);
  return new Decimal(item.unitPrice)
    .mul(item.quantity)
    .toDecimalPlaces(digits, Decimal.ROUND_HALF_UP)
    .toFixed(digits);
}
export function totalAmount(s: Shipment): string {
  return s.items
    .reduce((sum, i) => sum.add(lineAmount(i, s.currency)), new Decimal(0))
    .toFixed(currencyDigits(s.currency));
}
export function formatDecimal(
  value: string,
  locale: string,
  digits: number,
): string {
  const fixed = new Decimal(value).toFixed(digits);
  const [whole, fraction] = fixed.split(".");
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const integer = formatter.format(BigInt(whole));
  if (!fraction) return integer;
  const separator = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 })
    .formatToParts(1.1)
    .find((p) => p.type === "decimal")!.value;
  const localizedFraction = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumIntegerDigits: digits,
  }).format(Number(fraction));
  return integer + separator + localizedFraction;
}
export function money(
  value: string,
  locale = "en-GB",
  currency = "USD",
): string {
  return formatDecimal(value, locale, currencyDigits(currency));
}
export function validateShipment(
  s: Shipment,
  settings: WorkspaceSettings = defaultSettings,
): Issue[] {
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
      source: "Workspace data requirements",
    });
  if (!s.originCountry)
    add("originCountry", "Choose the shipment’s origin country.");
  if (!s.destinationCountry)
    add("destinationCountry", "Choose the shipment’s destination country.");
  if (!s.exporter.name.trim())
    add("exporter.name", "Enter the exporter’s legal name.");
  if (!s.consignee.name.trim())
    add("consignee.name", "Enter the consignee’s legal name.");
  if (settings.buyerPoRequired && !s.buyerPo.trim())
    add(
      "buyerPo",
      "Add the buyer PO reference, or confirm it is not needed.",
      "blocker",
    );
  if (!s.items.length) add("items", "Add at least one goods line.");
  s.items.forEach((item, index) => {
    const prefix = `items.${index}`;
    if (!item.description.trim())
      add(prefix + ".description", `Line ${index + 1}: enter a description.`);
    if (!new RegExp(`^\\d{${settings.hsCodeDigits}}$`).test(item.hsCode))
      add(
        prefix + ".hsCode",
        `Line ${index + 1}: enter a ${settings.hsCodeDigits}-digit HS code.`,
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
  for (const field of settings.customFields) {
    if (field.hidden) continue;
    const value = s.custom?.[field.key];
    const empty = value === undefined || value === "";
    if (
      field.required &&
      (empty || (field.type === "checkbox" && value !== true))
    )
      add("custom." + field.key, `Enter ${field.label}.`);
    if (empty) continue;
    if (
      (field.type === "number" && typeof value !== "number") ||
      (field.type === "checkbox" && typeof value !== "boolean") ||
      (["text", "date", "select"].includes(field.type) &&
        typeof value !== "string")
    )
      add("custom." + field.key, `${field.label} has an invalid value type.`);
    else if (field.type === "select" && !field.options.includes(String(value)))
      add("custom." + field.key, `Choose a valid option for ${field.label}.`);
    else if (field.type === "date" && !z.iso.date().safeParse(value).success)
      add("custom." + field.key, `Enter a valid date for ${field.label}.`);
  }
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
export function renderDocument(
  s: Shipment,
  type: DocumentType,
  settings: WorkspaceSettings = defaultSettings,
): string {
  const e = escape;
  const invoice = type === "invoice";
  return `<!doctype html><html lang="${e(settings.locale)}"><head><meta charset="utf-8"><style>
 @page{size:A4;margin:16mm}@media screen{body{width:210mm;min-height:297mm;padding:16mm}}*{box-sizing:border-box}body{margin:0;color:${e(settings.primaryColor)};font:11px Arial,sans-serif;line-height:1.5}header{display:flex;justify-content:space-between;border-bottom:2px solid ${e(settings.primaryColor)};padding-bottom:20px}header>div:first-child{max-width:55%}header>div:last-child{max-width:44%}h1{font-size:21px;margin:0}h2{font-size:12px;margin:0 0 5px}p{margin:2px 0}.muted{color:#64748b}.arabic{font-family:Arial,sans-serif;direction:rtl}.parties{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d5dce6;margin:20px 0}.box{padding:12px;overflow-wrap:anywhere}.box+.box{border-left:1px solid #d5dce6}table{border-collapse:collapse;width:100%;margin:18px 0;table-layout:fixed}thead{display:table-header-group}th{background:${e(settings.primaryColor)};color:white;text-align:left;padding:8px;font-size:10px}td{padding:10px 8px;border-bottom:1px solid #d5dce6;overflow-wrap:anywhere}tr{break-inside:avoid}.number{text-align:right}.total{text-align:right;font-weight:bold;background:#f1f4f8;padding:12px}.summary{display:flex;justify-content:space-between;border:1px solid #d5dce6;padding:12px;margin:24px 0}.draft{position:fixed;top:40%;left:12%;font-size:100px;color:rgba(10,35,69,.045);transform:rotate(-35deg);z-index:-1}footer{margin-top:30px;border-top:1px solid #d5dce6;padding-top:10px;color:#64748b;font-size:9px}</style></head><body>
 <div class="draft">DRAFT</div><header><div><h2>${e(s.exporter.name)}</h2><p>${e(s.exporter.address)}</p><p class="muted">Tax ID ${e(s.exporter.taxId)}</p></div><div style="text-align:right"><h1>${e(settings.documentTitles[type])}</h1><h2 class="arabic" lang="ar">${e(settings.secondaryTitles[type])}</h2><p>DRAFT</p></div></header>
 <section class="parties"><div class="box"><p class="muted">BUYER / CONSIGNEE</p><h2>${e(s.consignee.name)}</h2><p>${e(s.consignee.address)}</p><p>Tax ID ${e(s.consignee.taxId) || "—"}</p></div><div class="box"><p>Shipment reference: <b>${e(s.id)}</b></p><p>Date: ${e(s.date)}</p><p>Buyer PO: ${e(s.buyerPo) || "—"}</p><p>Terms: ${e(s.incoterm)} ${e(s.portOfDischarge)}</p><p>Loading: ${e(s.portOfLoading)}</p></div></section>
 <table><thead><tr><th style="width:6%">#</th><th style="width:${invoice ? "36" : "50"}%">Description</th><th style="width:16%">HS code</th><th>Qty</th><th>Unit</th>${invoice ? `<th>Price</th><th style="width:17%">Amount ${e(s.currency)}</th>` : ""}</tr></thead><tbody>${s.items.map((i, index) => `<tr><td>${index + 1}</td><td>${e(i.description)}</td><td>${e(i.hsCode)}</td><td class="number">${e(i.quantity)}</td><td>${e(i.unit)}</td>${invoice ? `<td class="number">${e(formatDecimal(i.unitPrice, settings.locale, Math.max(new Decimal(i.unitPrice).decimalPlaces(), currencyDigits(s.currency))))}</td><td class="number">${e(money(lineAmount(i, s.currency), settings.locale, s.currency))}</td>` : ""}</tr>`).join("")}</tbody></table>
 ${invoice ? `<div class="total">Total (${e(s.currency)}) &nbsp; ${e(money(totalAmount(s), settings.locale, s.currency))}</div>` : ""}
 <section class="summary"><div>Packages<br><b>${e(s.packages)} ${e(settings.packageLabel)}</b></div><div>Net weight<br><b>${e(s.netKg)} kg</b></div><div>Gross weight<br><b>${e(s.grossKg)} kg</b></div></section>
 ${settings.customFields
   .filter((field) => !field.hidden)
   .map(
     (field) =>
       `<p><b>${e(field.label)}:</b> ${e(s.custom?.[field.key] ?? "—")}</p>`,
   )
   .join("")}
 <h2>Declaration</h2><p>${e(settings.declaration)}</p><footer>${e(settings.brandName)} · Draft · Not an issued document</footer></body></html>`;
}
