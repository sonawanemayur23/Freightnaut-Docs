// filepath: packages/domain/src/numbering.test.ts
import { describe, it, expect } from "vitest";
import {
  seriesSchema,
  formatDocumentNumber,
  numberingPeriod,
  type NumberSeries,
} from "./numbering";
import { validateRolePermissions } from "./access";
const series: NumberSeries = {
  name: "Export invoice",
  documentType: "invoice",
  prefix: "EXP",
  pattern: "{prefix}/{branch}/{fy}/{seq}",
  padding: 4,
  startsAt: 1,
  reset: "financial",
  financialYearStartMonth: 4,
  separateByBranch: true,
  branches: [{ code: "HQ", name: "Head office" }],
  active: true,
};
describe("document numbering", () => {
  it("uses the workspace timezone at financial-year boundaries", () => {
    expect(
      formatDocumentNumber(
        series,
        "HQ",
        149,
        new Date("2026-03-31T18:29:00Z"),
        "Asia/Kolkata",
      ),
    ).toBe("EXP/HQ/25-26/0149");
    expect(
      formatDocumentNumber(
        series,
        "HQ",
        149,
        new Date("2026-03-31T18:30:00Z"),
        "Asia/Kolkata",
      ),
    ).toBe("EXP/HQ/26-27/0149");
    expect(
      numberingPeriod(series, new Date("2026-03-31T18:30:00Z"), "UTC").period,
    ).toBe("fy:2025-4");
  });
  it("does not truncate a sequence when it exceeds padding", () => {
    expect(
      formatDocumentNumber(
        { ...series, padding: 2 },
        "HQ",
        123,
        new Date("2026-10-01"),
        "UTC",
      ),
    ).toBe("EXP/HQ/26-27/123");
  });
  it("requires period and branch tokens to prevent reset collisions", () => {
    for (const patch of [
      { pattern: "{prefix}/{seq}" },
      { pattern: "{prefix}/{branch}/{yyyy}/{seq}", reset: "monthly" },
      { pattern: "{prefix}/{branch}/{fy}/{seq}", reset: "calendar" },
      { pattern: "{seq}/{seq}" },
      { pattern: "{eval}/{seq}" },
      { branches: [series.branches[0], series.branches[0]] },
    ])
      expect(seriesSchema.safeParse({ ...series, ...patch }).success).toBe(
        false,
      );
    expect(
      seriesSchema.safeParse({
        ...series,
        reset: "never",
        separateByBranch: false,
        pattern: "{prefix}/{seq}",
      }).success,
    ).toBe(true);
  });
  it("resets monthly and calendar counters in the chosen timezone", () => {
    expect(
      numberingPeriod(
        { ...series, reset: "monthly" },
        new Date("2026-12-31T23:30:00Z"),
        "Asia/Kolkata",
      ).period,
    ).toBe("month:2027-01");
    expect(
      numberingPeriod(
        { ...series, reset: "calendar" },
        new Date("2026-12-31T23:30:00Z"),
        "UTC",
      ).period,
    ).toBe("year:2026");
  });
  it("does not grant reservation capability without shipment read and write", () => {
    const capability = ["document.number.reserve"] as const;
    expect(
      validateRolePermissions("account", capability, [
        "document.number.reserve",
      ]),
    ).toBe(false);
    expect(
      validateRolePermissions(
        "partner",
        ["document.number.reserve", "shipment.read", "shipment.write"],
        ["document.number.reserve", "shipment.read", "shipment.write"],
      ),
    ).toBe(false);
  });
});
