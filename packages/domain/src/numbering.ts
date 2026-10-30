// filepath: packages/domain/src/numbering.ts
import { z } from "zod";
const tokens = ["prefix", "branch", "fy", "yyyy", "mm", "seq"] as const;
export const seriesSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    documentType: z.enum(["invoice", "packing-list"]),
    prefix: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
    pattern: z.string().min(1).max(100),
    padding: z.number().int().min(1).max(12),
    startsAt: z.number().int().min(1).max(999999999),
    reset: z.enum(["never", "calendar", "financial", "monthly"]),
    financialYearStartMonth: z.number().int().min(1).max(12),
    separateByBranch: z.boolean(),
    branches: z
      .array(
        z.strictObject({
          code: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,11}$/),
          name: z.string().trim().min(1).max(80),
        }),
      )
      .min(1)
      .max(50),
    active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const found = [...value.pattern.matchAll(/\{([^{}]+)\}/g)].map(
      (match) => match[1],
    );
    if (
      !/^[A-Za-z0-9 /_.{}-]+$/.test(value.pattern) ||
      /[{}]/.test(
        value.pattern.replace(/\{(prefix|branch|fy|yyyy|mm|seq)\}/g, ""),
      ) ||
      found.some(
        (token) => !tokens.includes(token as (typeof tokens)[number]),
      ) ||
      found.filter((token) => token === "seq").length !== 1
    )
      ctx.addIssue({
        code: "custom",
        path: ["pattern"],
        message:
          "Use exactly one {seq} and only prefix, branch, fy, yyyy, mm tokens.",
      });
    if (value.reset === "calendar" && !found.includes("yyyy"))
      ctx.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "Calendar resets require {yyyy} in the number.",
      });
    if (value.reset === "financial" && !found.includes("fy"))
      ctx.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "Financial-year resets require {fy} in the number.",
      });
    if (
      value.reset === "monthly" &&
      (!found.includes("yyyy") || !found.includes("mm"))
    )
      ctx.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "Monthly resets require {yyyy} and {mm} in the number.",
      });
    if (value.separateByBranch && !found.includes("branch"))
      ctx.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "Separate branch counters require {branch} in the number.",
      });
    if (
      new Set(value.branches.map((branch) => branch.code)).size !==
      value.branches.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["branches"],
        message: "Branch codes must be unique.",
      });
    if (value.pattern.replace(/\{[^{}]+\}/g, "X".repeat(20)).length > 200)
      ctx.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "The rendered number must fit within 200 characters.",
      });
  });
export type NumberSeries = z.infer<typeof seriesSchema>;
export interface SeriesRecord {
  id: string;
  revision: number;
  config: NumberSeries;
  next: { branch: string; number: string; sequence: number; period: string }[];
}
export interface NumberReservation {
  id: string;
  documentType: "invoice" | "packing-list";
  number: string;
  branch: string;
  sequence: number;
  status: "reserved" | "voided";
  createdAt: string;
  voidReason: string | null;
  seriesName: string;
  seriesRevision: number;
}
export function numberingPeriod(
  config: NumberSeries,
  now: Date,
  timeZone: string,
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(now),
    year = Number(parts.find((part) => part.type === "year")!.value),
    month = Number(parts.find((part) => part.type === "month")!.value);
  const fyStart = month >= config.financialYearStartMonth ? year : year - 1;
  const fyEnd = config.financialYearStartMonth === 1 ? fyStart : fyStart + 1;
  const values = {
    yyyy: String(year),
    mm: String(month).padStart(2, "0"),
    fy: String(fyStart).slice(-2) + "-" + String(fyEnd).slice(-2),
  };
  const period =
    config.reset === "never"
      ? "never"
      : config.reset === "calendar"
        ? `year:${year}`
        : config.reset === "monthly"
          ? `month:${year}-${values.mm}`
          : `fy:${fyStart}-${config.financialYearStartMonth}`;
  return { period, values };
}
export function formatDocumentNumber(
  config: NumberSeries,
  branch: string,
  sequence: number,
  now: Date,
  timeZone: string,
) {
  const { values } = numberingPeriod(config, now, timeZone);
  const rendered = {
    ...values,
    prefix: config.prefix,
    branch,
    seq: String(sequence).padStart(config.padding, "0"),
  };
  return config.pattern.replace(
    /\{(prefix|branch|fy|yyyy|mm|seq)\}/g,
    (_, token: keyof typeof rendered) => rendered[token],
  );
}

export const reserveNumberSchema = z.strictObject({
  version: z.number().int().positive(),
  seriesId: z.uuid(),
  seriesRevision: z.number().int().positive(),
  branch: z.string().max(12),
  idempotencyKey: z.uuid(),
});
export const voidNumberSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
