import "dotenv/config";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { Pool } from "pg";
import assert from "node:assert/strict";
if (
  process.env.NODE_ENV !== "development" ||
  process.env.LOCAL_SELF_SERVICE_SIGNUP !== "true"
)
  throw new Error(
    "Registration smoke test requires explicit local development signup.",
  );
const provider = JSON.parse(process.env.OIDC_PROVIDERS!)[0] as {
  issuer: string;
};
const issuer = new URL(provider.issuer);
if (!["127.0.0.1", "localhost"].includes(issuer.hostname))
  throw new Error("Only local identity testing is permitted.");
const suffix = randomBytes(6).toString("hex"),
  email = `registration-${suffix}@example.test`,
  password = randomBytes(20).toString("hex");
const browser = await chromium.launch({ headless: true }),
  pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  const page = await browser.newPage();
  await page.goto(process.env.PUBLIC_ORIGIN!);
  await page
    .getByRole("link", { name: "Create an account", exact: true })
    .click();
  await page.screenshot({
    path: "../work/ui-refresh/registration.png",
    fullPage: true,
  });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#password-confirm").fill(password);
  await page.locator('input[type="submit"],button[type="submit"]').click();
  await page
    .getByRole("heading", { name: "Welcome. Let’s set up your workspace." })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Company name", exact: true })
    .fill("Registration check " + suffix);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your shipments", exact: true })
    .waitFor();
  const context = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session");
    return response.json();
  });
  assert.equal(context.operator, false);
  assert.equal(context.tenants.length, 2);
  const user = (
    await pool.query(
      "SELECT email_verified FROM users WHERE issuer=$1 AND email=$2",
      [provider.issuer, email],
    )
  ).rows[0];
  assert.equal(
    user.email_verified,
    false,
    "Local testing must not fabricate a verified-email claim.",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("heading", { name: "Welcome to Freightnaut Docs." })
    .waitFor();
  await page.context().clearCookies();
  await page
    .getByRole("link", { name: /Continue with/ })
    .first()
    .click();
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="login"],button[name="login"]').click();
  await page.getByRole("combobox", { name: "Active workspace" }).waitFor();
  console.log(
    "Passed real registration → company setup → workspace → sign-out → sign-in, without email verification or administrator provisioning. No platform privileges granted.",
  );
} finally {
  await browser.close();
  const users = await pool.query(
    "SELECT id,subject FROM users WHERE issuer=$1 AND email=$2",
    [provider.issuer, email],
  );
  for (const user of users.rows) {
    const tenants = (
      await pool.query("SELECT tenant_id FROM memberships WHERE user_id=$1", [
        user.id,
      ])
    ).rows.map((row) => row.tenant_id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM audit_events WHERE actor_id=$1", [
        user.id,
      ]);
      await client.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM memberships WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM roles WHERE tenant_id=ANY($1::uuid[])", [
        tenants,
      ]);
      await client.query(
        "DELETE FROM tenants WHERE id=ANY($1::uuid[]) AND kind='account'",
        [tenants],
      );
      await client.query(
        "DELETE FROM tenants WHERE id=ANY($1::uuid[]) AND kind='partner'",
        [tenants],
      );
      await client.query("DELETE FROM users WHERE id=$1", [user.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  // Remove the generated identity even if registration failed before its OIDC callback.
  const auth = await fetch(
    issuer.origin + "/realms/master/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        username: process.env.KEYCLOAK_ADMIN_USER!,
        password: process.env.KEYCLOAK_ADMIN_PASSWORD!,
      }),
    },
  );
  if (auth.ok) {
    const token = (await auth.json()).access_token;
    const headers = { authorization: "Bearer " + token };
    const base = issuer.origin + "/admin" + issuer.pathname;
    const identities = await (
      await fetch(
        base + "/users?exact=true&email=" + encodeURIComponent(email),
        { headers },
      )
    ).json();
    for (const identity of identities)
      await fetch(base + "/users/" + identity.id, {
        method: "DELETE",
        headers,
      });
  }
  await pool.end();
}
