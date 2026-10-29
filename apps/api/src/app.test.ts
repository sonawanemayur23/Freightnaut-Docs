import { it, expect } from "vitest";
import { buildApp } from "./app";
import { sampleShipment } from "@freightnaut/domain";
it("serves sample data and validates payloads through HTTP", async () => {
  const app = buildApp();
  try {
    expect((await app.inject("/api/sample")).json()).toEqual(sampleShipment);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/validate",
          payload: sampleShipment,
        })
      ).json(),
    ).toEqual({ issues: [] });
    expect(
      (await app.inject({ method: "POST", url: "/api/validate", payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/documents/unknown/pdf",
          payload: sampleShipment,
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
