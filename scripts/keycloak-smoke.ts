import "dotenv/config";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { Pool } from "pg";
import assert from "node:assert/strict";
if (process.env.NODE_ENV === "production")
  throw new Error("Local identity smoke test cannot run in production.");
const provider = JSON.parse(process.env.OIDC_PROVIDERS!)[0] as {
  issuer: string;
};
const issuer = new URL(provider.issuer);
if (!["127.0.0.1", "localhost"].includes(issuer.hostname))
  throw new Error("This smoke test only runs against local Keycloak.");
const base = issuer.origin,
  realm = issuer.pathname.split("/").at(-1)!;
const auth = await fetch(
  base + "/realms/master/protocol/openid-connect/token",
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
assert.equal(auth.status, 200, "Local Keycloak admin authentication failed.");
const adminToken = (await auth.json()).access_token as string;
const suffix = randomBytes(6).toString("hex"),
  email = `qa-${suffix}@example.test`,
  password = randomBytes(24).toString("hex");
const headers = {
  authorization: "Bearer " + adminToken,
  "content-type": "application/json",
};
const created = await fetch(`${base}/admin/realms/${realm}/users`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    username: email,
    email,
    emailVerified: true,
    enabled: true,
    firstName: "Local",
    lastName: "Verification",
    credentials: [{ type: "password", value: password, temporary: false }],
  }),
});
assert.equal(
  created.status,
  201,
  "Could not create disposable local verification identity.",
);
const resource = created.headers.get("location")!;
const browser = await chromium.launch({ headless: true });
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.PUBLIC_ORIGIN!);
  await page
    .getByRole("link", { name: /Continue with/ })
    .first()
    .click();
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="login"],button[name="login"]').click();
  await page.getByRole("heading", { name: "You’re signed in." }).waitFor();
  assert.deepEqual(errors, []);
  const user = (
    await pool.query("SELECT id FROM users WHERE issuer=$1 AND email=$2", [
      provider.issuer,
      email,
    ])
  ).rows[0];
  assert(user);
  assert.equal(
    (await pool.query("SELECT 1 FROM memberships WHERE user_id=$1", [user.id]))
      .rowCount,
    0,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("heading", { name: "Welcome to Freightnaut Docs." })
    .waitFor();
  console.log(
    "Real Keycloak browser sign-in, signed callback, access-pending state, no automatic membership and logout passed. Disposable identity removed.",
  );
} finally {
  await browser.close();
  const users = await pool.query(
    "SELECT id FROM users WHERE issuer=$1 AND email=$2",
    [provider.issuer, email],
  );
  for (const user of users.rows) {
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  }
  await pool.end();
  await fetch(resource, { method: "DELETE", headers });
}
