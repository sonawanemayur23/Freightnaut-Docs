import { it, expect } from "vitest";
import { Pool } from "pg";
import { buildApp } from "./app";
import { loadConfig } from "./config";
it("fails closed without a session; only health and provider metadata are public", async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    DATABASE_URL: "postgres://unused@127.0.0.1:1/unused",
    DB_SSL: "false",
    REQUIRE_ADMIN_MFA: "false",
    LOG_LEVEL: "silent",
    OIDC_PROVIDERS: JSON.stringify([
      {
        id: "test",
        name: "Identity service",
        issuer: "http://127.0.0.1:8080",
        clientId: "test",
        clientSecret: "test",
      },
    ]),
  });
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const app = await buildApp(config, pool);
  try {
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    const providers = (await app.inject("/api/auth/providers")).json();
    expect(providers.providers).toEqual([
      { id: "test", name: "Identity service" },
    ]);
    expect(JSON.stringify(providers)).not.toContain("clientSecret");
    for (const url of [
      "/api/auth/session",
      "/api/sample",
      "/api/validate",
      "/api/tenants/00000000-0000-4000-8000-000000000001/shipments",
    ]) {
      expect(
        (
          await app.inject({
            method: url.includes("validate") ? "POST" : "GET",
            url,
          })
        ).statusCode,
      ).toBe(401);
    }
  } finally {
    await app.close();
    await pool.end();
  }
});
