import { z } from "zod";
import type { Shipment } from "./index.js";
const text = z.string().max(2000);
export const customFieldKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .refine(
    (key) => !["constructor", "prototype"].includes(key),
    "Reserved field key",
  );
export const customFieldSchema = z
  .strictObject({
    key: customFieldKeySchema,
    label: z.string().trim().min(1).max(100),
    type: z.enum(["text", "number", "date", "select", "checkbox"]),
    help: z.string().max(500).default(""),
    required: z.boolean().default(false),
    hidden: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    defaultValue: z
      .union([z.string().max(2000), z.number().finite(), z.boolean()])
      .optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select" && field.options.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "A choice field needs options.",
      });
    const value = field.defaultValue;
    if (value === undefined) return;
    if (
      (field.type === "number" && typeof value !== "number") ||
      (field.type === "checkbox" && typeof value !== "boolean") ||
      (["text", "date", "select"].includes(field.type) &&
        typeof value !== "string")
    )
      ctx.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: "Default value must match the field type.",
      });
    if (field.type === "date" && !z.iso.date().safeParse(value).success)
      ctx.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: "Date defaults must use YYYY-MM-DD.",
      });
    if (field.type === "select" && !field.options.includes(String(value)))
      ctx.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: "Default must be one of the options.",
      });
  });
export type CustomField = z.infer<typeof customFieldSchema>;
export const workspaceSettingsSchema = z.strictObject({
  customFields: z
    .array(customFieldSchema)
    .max(100)
    .refine(
      (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
      "Field keys must be unique",
    ),
  brandName: z.string().trim().min(1).max(80),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  locale: z.string().refine((v) => {
    try {
      new Intl.NumberFormat(v);
      return true;
    } catch {
      return false;
    }
  }, "Unsupported locale"),
  timeZone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Unsupported time zone"),
  defaultCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine(
      (v) => Intl.supportedValuesOf("currency").includes(v),
      "Unknown ISO currency",
    ),
  originCountry: z.string().regex(/^([A-Z]{2})?$/),
  destinationCountry: z.string().regex(/^([A-Z]{2})?$/),
  defaultIncoterm: z.enum([
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
  exporter: z.strictObject({
    name: z.string().max(300),
    address: z.string().max(1500),
    taxId: z.string().max(100),
  }),
  packageLabel: z.string().trim().min(1).max(40),
  defaultUnit: z.string().trim().min(1).max(20),
  hsCodeDigits: z.union([z.literal(6), z.literal(8), z.literal(10)]),
  buyerPoRequired: z.boolean(),
  declaration: text,
  documentTitles: z.strictObject({
    invoice: z.string().trim().min(1).max(100),
    "packing-list": z.string().trim().min(1).max(100),
  }),
  secondaryTitles: z.strictObject({
    invoice: z.string().max(100),
    "packing-list": z.string().max(100),
  }),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export const defaultSettings: WorkspaceSettings = {
  customFields: [],
  brandName: "Freightnaut Docs",
  primaryColor: "#092040",
  accentColor: "#FFAD13",
  locale: "en-GB",
  timeZone: "UTC",
  defaultCurrency: "USD",
  originCountry: "",
  destinationCountry: "",
  defaultIncoterm: "EXW",
  exporter: { name: "", address: "", taxId: "" },
  packageLabel: "packages",
  defaultUnit: "PCS",
  hsCodeDigits: 6,
  buyerPoRequired: false,
  declaration: "",
  documentTitles: {
    invoice: "COMMERCIAL INVOICE",
    "packing-list": "PACKING LIST",
  },
  secondaryTitles: { invoice: "", "packing-list": "" },
};
export const settingKeys = workspaceSettingsSchema.keyof().options;
export type SettingKey = (typeof settingKeys)[number];
export const settingsPatchSchema = workspaceSettingsSchema.partial().strict();
export interface SettingsLayer {
  level: "base" | "partner" | "account" | "buyer" | "shipment";
  values: Partial<WorkspaceSettings>;
  locks: SettingKey[];
}
export function resolveSettings(layers: SettingsLayer[]) {
  const values: Record<string, unknown> = { ...defaultSettings };
  const provenance: Record<
    string,
    { source: string; lockedBy: string | null }
  > = {};
  for (const key of settingKeys)
    provenance[key] = { source: "base", lockedBy: null };
  const order = ["base", "partner", "account", "buyer", "shipment"];
  let last = -1;
  for (const layer of layers) {
    const rank = order.indexOf(layer.level);
    if (rank <= last)
      throw new Error("Settings layers must be unique and ordered");
    last = rank;
    const parsed = settingsPatchSchema.parse(layer.values);
    for (const key of Object.keys(parsed) as SettingKey[]) {
      if (provenance[key].lockedBy) continue;
      values[key] = parsed[key];
      provenance[key] = { source: layer.level, lockedBy: null };
    }
    for (const key of layer.locks) {
      if (!settingKeys.includes(key)) throw new Error("Unknown lock");
      if (!provenance[key].lockedBy) provenance[key].lockedBy = layer.level;
    }
  }
  return { values: workspaceSettingsSchema.parse(values), provenance };
}
export function createBlankShipment(settings: WorkspaceSettings): Shipment {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return {
    custom: Object.fromEntries(
      settings.customFields
        .filter((field) => !field.hidden && field.defaultValue !== undefined)
        .map((field) => [field.key, field.defaultValue!]),
    ),
    id: "",
    date,
    buyerPo: "",
    exporter: { ...settings.exporter },
    consignee: { name: "", address: "", taxId: "" },
    currency: settings.defaultCurrency,
    incoterm: settings.defaultIncoterm,
    originCountry: settings.originCountry,
    destinationCountry: settings.destinationCountry,
    portOfLoading: "",
    portOfDischarge: "",
    packages: 0,
    netKg: 0,
    grossKg: 0,
    items: [],
  };
}
export interface SettingsView {
  values: WorkspaceSettings;
  inheritedValues: WorkspaceSettings;
  provenance: Record<string, { source: string; lockedBy: string | null }>;
  overrides: Partial<WorkspaceSettings>;
  locks: SettingKey[];
  revision: number;
}
