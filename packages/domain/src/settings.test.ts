import { describe, it, expect } from "vitest";
import {
  resolveSettings,
  defaultSettings,
  workspaceSettingsSchema,
  createBlankShipment,
  customFieldSchema,
} from "./settings";
import { validateRolePermissions, permissionCeilings } from "./access";
import { renderDocument, totalAmount, money, validateShipment } from "./index";
import { sampleShipment } from "./fixtures";
describe("settings and permission boundaries", () => {
  it("resolves inherited values and ignores stale descendant overrides beneath parent locks", () => {
    const result = resolveSettings([
      {
        level: "partner",
        values: { brandName: "Partner brand", defaultCurrency: "EUR" },
        locks: ["brandName"],
      },
      {
        level: "account",
        values: { brandName: "Stale override", locale: "de-DE" },
        locks: [],
      },
    ]);
    expect(result.values.brandName).toBe("Partner brand");
    expect(result.provenance.brandName.lockedBy).toBe("partner");
    expect(result.values.defaultCurrency).toBe("EUR");
    expect(result.provenance.locale.source).toBe("account");
  });
  it("rejects executable configuration and scope escalation", () => {
    expect(
      workspaceSettingsSchema.safeParse({
        ...defaultSettings,
        primaryColor: "red; background:url(https://evil.test)",
      }).success,
    ).toBe(false);
    expect(
      validateRolePermissions(
        "account",
        ["partner.accounts.manage"],
        permissionCeilings.account,
      ),
    ).toBe(false);
    expect(
      validateRolePermissions(
        "account",
        ["shipment.write"],
        permissionCeilings.account,
      ),
    ).toBe(false);
    expect(
      validateRolePermissions(
        "account",
        ["shipment.read"],
        ["tenant.roles.manage"],
      ),
    ).toBe(false);
  });
  it("creates blank shipments from configuration instead of a sample company", () => {
    const settings = {
      ...defaultSettings,
      defaultCurrency: "EUR",
      exporter: { name: "Configured exporter", address: "Address", taxId: "" },
    };
    expect(createBlankShipment(settings)).toMatchObject({
      currency: "EUR",
      items: [],
      exporter: { name: "Configured exporter" },
    });
  });
  it("uses currency precision and locale, and escapes configured document wording", () => {
    const yen = { ...sampleShipment, currency: "JPY" };
    expect(totalAmount(yen)).toBe("23952");
    expect(money("1234.5", "de-DE", "EUR")).toBe("1.234,50");
    expect(money("12345678901234567890.12", "en-GB", "USD")).toBe(
      "12,345,678,901,234,567,890.12",
    );
    expect(
      renderDocument(yen, "invoice", {
        ...defaultSettings,
        declaration: "<script>bad()</script>",
      }),
    ).toContain("&lt;script&gt;");
    expect(renderDocument(yen, "invoice")).toContain("Amount JPY");
  });
});

it("uses custom field defaults, requirements, types and escaped output", () => {
  const field = customFieldSchema.parse({
    key: "inspection_ref",
    label: "Inspection reference",
    type: "text",
    required: true,
    defaultValue: "INS-01",
  });
  const settings = { ...defaultSettings, customFields: [field] };
  const fresh = createBlankShipment(settings);
  expect(fresh.custom.inspection_ref).toBe("INS-01");
  const shipment = { ...sampleShipment, custom: { inspection_ref: "" } };
  expect(
    validateShipment(shipment, settings).some(
      (i) => i.field === "custom.inspection_ref",
    ),
  ).toBe(true);
  const hidden = { ...settings, customFields: [{ ...field, hidden: true }] };
  expect(
    validateShipment(shipment, hidden).some(
      (i) => i.field === "custom.inspection_ref",
    ),
  ).toBe(false);
  expect(
    renderDocument(
      { ...shipment, custom: { inspection_ref: "<img src=x>" } },
      "invoice",
      settings,
    ),
  ).toContain("&lt;img src=x&gt;");
  expect(
    customFieldSchema.safeParse({
      key: "number_field",
      label: "Number",
      type: "number",
      defaultValue: "not a number",
    }).success,
  ).toBe(false);
});
