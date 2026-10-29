import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";
const base = {
  NODE_ENV: "production",
  PUBLIC_ORIGIN: "https://docs.example.com",
  DATABASE_URL: "postgres://example",
  DB_SSL: "true",
  REQUIRE_ADMIN_MFA: "true",
  OIDC_PROVIDERS: JSON.stringify([
    {
      id: "main",
      name: "Sign-in",
      issuer: "https://identity.example.com/",
      clientId: "client",
      clientSecret: "secret",
    },
  ]),
};
describe("production configuration", () => {
  it("requires HTTPS, database TLS and administrative MFA", () => {
    expect(loadConfig(base).secureCookies).toBe(true);
    for (const patch of [
      { PUBLIC_ORIGIN: "http://docs.example.com" },
      { DB_SSL: "false" },
      { REQUIRE_ADMIN_MFA: "false" },
      { OIDC_PROVIDERS: base.OIDC_PROVIDERS.replace("https:", "http:") },
    ])
      expect(() => loadConfig({ ...base, ...patch })).toThrow();
  });
  it("does not allow duplicate provider identifiers or path-based origins", () => {
    const provider = JSON.parse(base.OIDC_PROVIDERS)[0];
    expect(() =>
      loadConfig({
        ...base,
        OIDC_PROVIDERS: JSON.stringify([provider, provider]),
      }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...base, PUBLIC_ORIGIN: "https://docs.example.com/path" }),
    ).toThrow();
  });
});
