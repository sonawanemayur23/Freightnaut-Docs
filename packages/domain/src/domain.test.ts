import { describe, it, expect } from "vitest";
import {
  totalAmount,
  lineAmount,
  validateShipment,
  renderDocument,
  shipmentSchema,
} from "./index";
import { sampleShipment } from "./fixtures";
describe("shipment engine", () => {
  it("calculates sample invoice and rounds decimal money without binary float drift", () => {
    expect(totalAmount(sampleShipment)).toBe("23952.00");
    expect(
      lineAmount({
        ...sampleShipment.items[0],
        quantity: 3,
        unitPrice: "0.10",
      }),
    ).toBe("0.30");
  });
  it("returns actionable paths for invalid weight and goods", () => {
    const s = structuredClone(sampleShipment);
    s.grossKg = 1;
    s.items[0].hsCode = "123";
    expect(validateShipment(s).map((i) => i.field)).toEqual(
      expect.arrayContaining(["grossKg", "items.0.hsCode"]),
    );
  });
  it("escapes customer content in both documents and excludes prices from packing lists", () => {
    const s = structuredClone(sampleShipment);
    s.consignee.name = "<script>alert(1)</script>";
    for (const type of ["invoice", "packing-list"] as const) {
      expect(renderDocument(s, type)).not.toContain("<script>");
    }
    expect(renderDocument(s, "packing-list")).not.toContain("23,952.00");
  });
  it("rejects invalid numeric payloads before rendering", () => {
    expect(
      shipmentSchema.safeParse({ ...sampleShipment, grossKg: -1 }).success,
    ).toBe(false);
  });
});
