import "dotenv/config";
import { Pool } from "pg";
import Fastify from "fastify";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { DocumentRunner } from "../apps/api/src/documents/runner.js";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { loadConfig } from "../apps/api/src/config.js";
import { buildApp } from "../apps/api/src/app.js";
import { assertRuntimeRole, transaction } from "../apps/api/src/db.js";
import {
  issueSession,
  tokenHash,
  type Actor,
} from "../apps/api/src/auth/session.js";
import { createTenant, settingsFor } from "../apps/api/src/tenancy/service.js";
import { sampleShipment } from "../packages/domain/src/fixtures.js";
import { defaultSettings, type Shipment } from "@freightnaut/domain";

// An isolated database and a signed test OIDC issuer. No test authentication routes are shipped.
if (process.env.NODE_ENV === "production")
  throw new Error("Integration tests cannot run in production.");
const adminUrl = new URL(
  process.env.TEST_DATABASE_ADMIN_URL ??
    process.env.MIGRATION_DATABASE_URL ??
    "",
);
if (!["127.0.0.1", "localhost"].includes(adminUrl.hostname))
  throw new Error(
    "Integration tests require an explicitly local database server.",
  );
const database = "freightnaut_test_" + randomBytes(6).toString("hex");
const admin = new Pool({ connectionString: adminUrl.href });
await admin.query(`CREATE DATABASE "${database}"`);
const ownerUrl = new URL(adminUrl);
ownerUrl.pathname = "/" + database;
const runtimeUrl = new URL(process.env.DATABASE_URL!);
runtimeUrl.pathname = "/" + database;
const migration = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/migrate.ts"],
  {
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl.href },
    encoding: "utf8",
  },
);
if (migration.status !== 0)
  throw new Error("Test migration failed: " + migration.stderr);
const owner = new Pool({ connectionString: ownerUrl.href }),
  pool = new Pool({ connectionString: runtimeUrl.href });
const issuerApp = Fastify({ logger: false });
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = {
  ...(await exportJWK(publicKey)),
  kid: "integration-key",
  alg: "RS256",
  use: "sig",
};
const codes = new Map<
  string,
  {
    nonce: string;
    challenge: string;
    redirect: string;
    client: string;
    subject: string;
    email: string;
    verified: boolean;
    invalid?: string;
  }
>();
let nextClaims = {
  subject: "first-admin",
  email: "admin@example.test",
  verified: true,
  invalid: "",
};
let issuer = "";
issuerApp.get("/.well-known/openid-configuration", async () => ({
  issuer,
  authorization_endpoint: issuer + "/authorize",
  token_endpoint: issuer + "/token",
  jwks_uri: issuer + "/jwks",
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  token_endpoint_auth_methods_supported: ["client_secret_post"],
  code_challenge_methods_supported: ["S256"],
}));
issuerApp.get("/jwks", async () => ({ keys: [publicJwk] }));
issuerApp.get<{ Querystring: Record<string, string> }>(
  "/authorize",
  async (req, reply) => {
    const q = req.query;
    assert.equal(q.code_challenge_method, "S256");
    const code = randomBytes(24).toString("hex");
    codes.set(code, {
      nonce: q.nonce,
      challenge: q.code_challenge,
      redirect: q.redirect_uri,
      client: q.client_id,
      ...nextClaims,
    });
    const url = new URL(q.redirect_uri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", q.state);
    return reply.redirect(url.href);
  },
);
issuerApp.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(String(body)))),
);
issuerApp.post<{ Body: Record<string, string> }>(
  "/token",
  async (req, reply) => {
    const input = req.body,
      value = codes.get(input.code);
    codes.delete(input.code);
    if (
      !value ||
      input.client_id !== value.client ||
      input.client_secret !== "integration-secret" ||
      input.redirect_uri !== value.redirect ||
      createHash("sha256").update(input.code_verifier).digest("base64url") !==
        value.challenge
    )
      return reply.code(400).send({ error: "invalid_grant" });
    const claims = {
      nonce: value.invalid === "nonce" ? "wrong" : value.nonce,
      email: value.email,
      email_verified: value.verified,
      name: "Integration user",
      amr: ["mfa"],
      roles: ["owner"],
    };
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
      .setIssuer(issuer)
      .setAudience(value.invalid === "audience" ? "wrong" : value.client)
      .setSubject(value.subject)
      .setIssuedAt()
      .setExpirationTime(
        value.invalid === "expired"
          ? Math.floor(Date.now() / 1000) - 300
          : "5m",
      );
    return {
      access_token: randomBytes(24).toString("hex"),
      token_type: "Bearer",
      expires_in: 300,
      id_token: await jwt.sign(privateKey),
    };
  },
);
await issuerApp.listen({ host: "127.0.0.1", port: 0 });
issuer = issuerApp.listeningOrigin;
const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  LOCAL_SELF_SERVICE_SIGNUP: "false",
  SERVE_WEB: "true",
  LOG_LEVEL: "silent",
  PDF_QUEUE_NAME: database,
  DATABASE_URL: runtimeUrl.href,
  OIDC_PROVIDERS: JSON.stringify([
    {
      id: "test",
      name: "Test identity",
      issuer,
      clientId: "integration-web",
      clientSecret: "integration-secret",
    },
  ]),
});
const app = await buildApp(config, pool);
const documentRunner = new DocumentRunner(pool, config, () => {});
let count = 0;
const check = (name: string) => {
  count++;
  console.log("PASS", name);
};
interface Client {
  token: string;
  csrf: string;
  userId: string;
}
async function request(
  client: Client,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: {
      cookie: "freightnaut_session=" + client.token,
      origin: config.PUBLIC_ORIGIN,
      "x-csrf-token": client.csrf,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}
async function oidcLogin(claims = nextClaims): Promise<Client> {
  nextClaims = claims;
  const login = await app.inject("/api/auth/login/test");
  assert.equal(login.statusCode, 302, login.body);
  const binder = login.cookies.find((c) => c.name === "freightnaut_login")!;
  const authorize = await fetch(login.headers.location!, {
    redirect: "manual",
  });
  const callback = new URL(authorize.headers.get("location")!);
  const response = await app.inject({
    url: callback.pathname + callback.search,
    headers: { cookie: "freightnaut_login=" + binder.value },
  });
  assert.equal(response.statusCode, 302, response.body);
  const cookie = response.cookies.find(
    (c) => c.name === "freightnaut_session",
  )!;
  assert(cookie.httpOnly);
  assert.equal(cookie.sameSite, "Lax");
  const session = await app.inject({
    url: "/api/auth/session",
    headers: { cookie: "freightnaut_session=" + cookie.value },
  });
  assert.equal(session.statusCode, 200, session.body);
  const data = session.json();
  return { token: cookie.value, csrf: data.csrfToken, userId: data.user.id };
}
async function fixtureUser(email: string, subject = email): Promise<Client> {
  const user = (
    await owner.query(
      "INSERT INTO users(issuer,subject,email,email_verified,name) VALUES($1,$2,$3,true,$3) RETURNING id",
      [issuer, subject, email],
    )
  ).rows[0];
  const token = await transaction(owner, null, (db) =>
    issueSession(db, user.id, ["mfa"], config),
  );
  const row = (
    await owner.query("SELECT csrf_token FROM sessions WHERE token_hash=$1", [
      tokenHash(token),
    ])
  ).rows[0];
  return { token, csrf: row.csrf_token, userId: user.id };
}
async function role(tenantId: string, key: string) {
  return (
    await owner.query("SELECT id FROM roles WHERE tenant_id=$1 AND key=$2", [
      tenantId,
      key,
    ])
  ).rows[0].id as string;
}
async function member(client: Client, tenantId: string, key: string) {
  await owner.query(
    "INSERT INTO memberships(user_id,tenant_id,role_id) VALUES($1,$2,$3)",
    [client.userId, tenantId, await role(tenantId, key)],
  );
}
async function expectStatus(
  response: Awaited<ReturnType<typeof request>>,
  status: number,
) {
  assert.equal(response.statusCode, status, response.body);
  return response.json();
}
try {
  await assertRuntimeRole(pool);
  check("runtime database role cannot bypass RLS");
  const adminClient = await oidcLogin();
  assert.equal(
    (await request(adminClient, "GET", "/api/auth/session")).json().tenants
      .length,
    0,
  );
  check(
    "real signed OIDC code exchange creates identity without trusting role claims",
  );
  const actor = { id: adminClient.userId } as Actor;
  const { partner, account, other } = await transaction(
    owner,
    actor.id,
    async (db) => {
      const partner = await createTenant(
        db,
        "partner",
        "Partner A",
        null,
        actor.id,
      );
      const account = await createTenant(
        db,
        "account",
        "Account A",
        partner.id,
        actor.id,
      );
      const otherPartner = await createTenant(
        db,
        "partner",
        "Partner B",
        null,
        null,
      );
      const other = await createTenant(
        db,
        "account",
        "Account B",
        otherPartner.id,
        null,
      );
      return { partner, account, other };
    },
  );
  const preparer = await fixtureUser("preparer@example.test"),
    reviewer = await fixtureUser("reviewer@example.test"),
    outsider = await fixtureUser("outsider@example.test"),
    developer = await fixtureUser("developer@example.test"),
    operator = await fixtureUser("operator@example.test"),
    manager = await fixtureUser("manager@example.test");
  await member(preparer, account.id, "preparer");
  await member(reviewer, account.id, "reviewer");
  await member(outsider, other.id, "owner");
  await member(developer, partner.id, "developer");
  await owner.query("INSERT INTO operators(user_id) VALUES($1)", [
    operator.userId,
  ]);
  const base = `/api/tenants/${account.id}`;
  const data = {
    ...sampleShipment,
    originCountry: "IN",
    destinationCountry: "AE",
  };
  assert.equal((await app.inject(base + "/shipments")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        url: base + "/shipments",
        headers: { authorization: "Bearer untrusted" },
      })
    ).statusCode,
    401,
  );
  check("anonymous and unimplemented service credentials fail closed");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/shipments",
        headers: {
          cookie: "freightnaut_session=" + preparer.token,
          origin: config.PUBLIC_ORIGIN,
        },
        payload: data,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/shipments",
        headers: {
          cookie: "freightnaut_session=" + preparer.token,
          origin: "https://evil.example",
          "x-csrf-token": preparer.csrf,
        },
        payload: data,
      })
    ).statusCode,
    403,
  );
  check("CSRF token and exact origin are enforced");
  const shipment = await expectStatus(
    await request(preparer, "POST", base + "/shipments", data),
    201,
  );
  const path = base + "/shipments/" + shipment.id;
  assert.equal((await request(reviewer, "GET", path)).statusCode, 200);
  assert.equal(
    (await request(reviewer, "PUT", path, { version: 1, data })).statusCode,
    403,
  );
  assert.equal((await request(developer, "GET", path)).statusCode, 403);
  assert.equal((await request(operator, "GET", path)).statusCode, 403);
  assert.equal((await request(outsider, "GET", path)).statusCode, 403);
  check(
    "preparer, reviewer, partner developer, operator and foreign account have distinct boundaries",
  );
  const saved = await expectStatus(
    await request(preparer, "PUT", path, {
      version: 1,
      data: { ...data, buyerPo: "NEW-PO" },
    }),
    200,
  );
  assert.equal(saved.version, 2);
  assert.equal(
    (await request(preparer, "PUT", path, { version: 1, data })).statusCode,
    409,
  );
  check("optimistic concurrency prevents lost shipment updates");
  // Search treats user input literally; cursor ordering survives equal timestamps.
  const repeated = await expectStatus(
    await request(preparer, "POST", path + "/copy"),
    201,
  );
  assert.equal(repeated.data.id, "");
  assert.equal(repeated.data.consignee.name, data.consignee.name);
  assert.notEqual(repeated.data.items[0].id, data.items[0].id);
  assert.equal(
    (await request(reviewer, "POST", path + "/copy")).statusCode,
    403,
  );
  assert.equal(
    (await request(outsider, "POST", path + "/copy")).statusCode,
    403,
  );
  const literal = await expectStatus(
    await request(preparer, "POST", base + "/shipments", {
      ...data,
      id: "literal%_reference",
    }),
    201,
  );
  const searchResult = await expectStatus(
    await request(
      preparer,
      "GET",
      base + "/shipments?q=" + encodeURIComponent("%_"),
    ),
    200,
  );
  assert.deepEqual(
    searchResult.shipments.map((row: any) => row.id),
    [literal.id],
  );
  await owner.query(
    "UPDATE shipments SET updated_at='2026-01-01T00:00:00.123456Z' WHERE id=ANY($1::uuid[])",
    [[shipment.id, repeated.id, literal.id]],
  );
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const result = await expectStatus(
      await request(
        preparer,
        "GET",
        base +
          "/shipments?limit=1" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      ),
      200,
    );
    seen.push(...result.shipments.map((row: any) => row.id));
    cursor = result.nextCursor;
  } while (cursor && seen.length < 10);
  assert.equal(new Set(seen).size, 3);
  assert.equal(seen.length, 3);
  assert.equal(
    (await request(preparer, "GET", base + "/shipments?cursor=invalid"))
      .statusCode,
    400,
  );
  await owner.query("DELETE FROM shipments WHERE id=ANY($1::uuid[])", [
    [repeated.id, literal.id],
  ]);
  check(
    "literal search, stable cursor pagination, isolated shipment copying and reviewer restrictions",
  );
  assert.equal((await pool.query("SELECT id FROM shipments")).rowCount, 0);
  const isolated = await transaction(pool, outsider.userId, (db) =>
    db.query("SELECT id FROM shipments WHERE id=$1", [shipment.id]),
  );
  assert.equal(isolated.rowCount, 0);
  await assert.rejects(
    () =>
      transaction(pool, outsider.userId, (db) =>
        db.query(
          "INSERT INTO shipments(tenant_id,data,created_by,updated_by) VALUES($1,$2,$3,$3)",
          [account.id, JSON.stringify(data), outsider.userId],
        ),
      ),
    (error: unknown) => (error as { code: string }).code === "42501",
  );
  check(
    "Postgres RLS independently blocks unscoped and cross-account reads/writes",
  );
  const roleResult = await expectStatus(
    await request(adminClient, "POST", base + "/roles", {
      name: "Membership coordinator",
      permissions: ["tenant.members.manage"],
    }),
    201,
  );
  await owner.query(
    "INSERT INTO memberships(user_id,tenant_id,role_id) VALUES($1,$2,$3)",
    [manager.userId, account.id, roleResult.id],
  );
  assert.equal(
    (
      await request(manager, "POST", base + "/invitations", {
        email: "escalation@example.test",
        roleId: await role(account.id, "owner"),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(adminClient, "POST", base + "/roles", {
        name: "Escape",
        permissions: ["partner.accounts.manage"],
      })
    ).statusCode,
    403,
  );
  check(
    "custom roles and invitations cannot elevate beyond actor or tenant scope",
  );
  const parentSettings = await settingsFor(owner, partner.id);
  assert.equal(
    (
      await request(adminClient, "PUT", `/api/tenants/${partner.id}/settings`, {
        revision: parentSettings.revision,
        overrides: { brandName: "Partner-owned brand", defaultCurrency: "EUR" },
        locks: ["brandName"],
      })
    ).statusCode,
    200,
  );
  const inherited = await expectStatus(
    await request(adminClient, "GET", base + "/settings"),
    200,
  );
  assert.equal(inherited.values.brandName, "Partner-owned brand");
  assert.equal(inherited.provenance.brandName.lockedBy, "partner");
  assert.equal(
    (
      await request(adminClient, "PUT", base + "/settings", {
        revision: inherited.revision,
        overrides: { brandName: "Forbidden override" },
        locks: [],
      })
    ).statusCode,
    403,
  );
  const configured = await expectStatus(
    await request(adminClient, "PUT", base + "/settings", {
      revision: inherited.revision,
      overrides: {
        customFields: [
          {
            key: "inspection_ref",
            label: "Inspection reference",
            type: "text",
            required: true,
            help: "Buyer inspection reference",
            hidden: false,
            options: [],
            defaultValue: "INS-DEFAULT",
          },
        ],
        locale: "de-DE",
        hsCodeDigits: 8,
        declaration: "Configured declaration",
        documentTitles: {
          invoice: "CUSTOM INVOICE",
          "packing-list": "CUSTOM PACKING LIST",
        },
      },
      locks: [],
    }),
    200,
  );
  assert.equal(configured.values.defaultCurrency, "EUR");
  assert.equal(configured.values.locale, "de-DE");
  assert.equal(
    (
      await request(adminClient, "PUT", base + "/settings", {
        revision: inherited.revision,
        overrides: {},
        locks: [],
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request(preparer, "PUT", base + "/settings", {
        revision: configured.revision,
        overrides: {},
        locks: [],
      })
    ).statusCode,
    403,
  );
  check(
    "versioned configuration, provenance, parent locks and administrator boundaries",
  );
  const invitee = await oidcLogin({
    subject: "invitee",
    email: "invitee@example.test",
    verified: true,
    invalid: "",
  });
  const invite = await expectStatus(
    await request(adminClient, "POST", base + "/invitations", {
      email: "invitee@example.test",
      roleId: await role(account.id, "reviewer"),
    }),
    201,
  );
  const token = new URL(invite.inviteUrl).hash.split("token=")[1];
  assert.equal(
    (await request(outsider, "POST", "/api/invitations/accept", { token }))
      .statusCode,
    403,
  );
  assert.equal(
    (await request(invitee, "POST", "/api/invitations/accept", { token }))
      .statusCode,
    200,
  );
  assert.equal(
    (await request(invitee, "POST", "/api/invitations/accept", { token }))
      .statusCode,
    410,
  );
  check("invitations bind verified email and are single-use");
  const sameEmail = await oidcLogin({
    subject: "different-subject",
    email: "invitee@example.test",
    verified: true,
    invalid: "",
  });
  assert.equal(
    (await request(sameEmail, "GET", base + "/shipments")).statusCode,
    403,
  );
  check(
    "matching email does not merge identities or grant existing membership",
  );
  const unverified = await oidcLogin({
    subject: "unverified",
    email: "unverified@example.test",
    verified: false,
    invalid: "",
  });
  const unverifiedInvite = await expectStatus(
    await request(adminClient, "POST", base + "/invitations", {
      email: "unverified@example.test",
      roleId: await role(account.id, "reviewer"),
    }),
    201,
  );
  assert.equal(
    (
      await request(unverified, "POST", "/api/invitations/accept", {
        token: new URL(unverifiedInvite.inviteUrl).hash.split("token=")[1],
      })
    ).statusCode,
    403,
  );
  check("unverified email cannot redeem workspace access");
  const external = await oidcLogin({
    subject: "external",
    email: "external@example.test",
    verified: true,
    invalid: "",
  });
  const externalInvite = await expectStatus(
    await request(adminClient, "POST", path + "/collaborators", {
      email: "external@example.test",
      allowDownload: false,
    }),
    201,
  );
  assert.equal(
    (
      await request(external, "POST", "/api/invitations/accept", {
        token: new URL(externalInvite.inviteUrl).hash.split("token=")[1],
      })
    ).statusCode,
    200,
  );
  assert.equal((await request(external, "GET", path)).statusCode, 200);
  assert.equal(
    (await request(external, "GET", base + "/shipments")).statusCode,
    403,
  );
  assert.equal(
    (await request(external, "PUT", path, { version: 2, data })).statusCode,
    403,
  );
  assert.equal(
    (
      await request(external, "POST", path + "/documents/invoice/pdf", {
        version: 2,
      })
    ).statusCode,
    403,
  );
  const grant = (
    await request(adminClient, "GET", path + "/collaborators")
  ).json().grants[0];
  assert.equal(
    (await request(adminClient, "DELETE", path + "/collaborators/" + grant.id))
      .statusCode,
    200,
  );
  assert.equal((await request(external, "GET", path)).statusCode, 403);
  check(
    "external collaborator is restricted to an expiring, revocable named shipment",
  );
  const beforeMembers = (
    await request(adminClient, "GET", base + "/members")
  ).json().members;
  const preparerMembership = beforeMembers.find(
    (m: { user_id: string }) => m.user_id === preparer.userId,
  );
  assert.equal(
    (
      await request(
        adminClient,
        "PATCH",
        base + "/members/" + preparerMembership.id,
        { status: "revoked" },
      )
    ).statusCode,
    200,
  );
  assert.equal((await request(preparer, "GET", path)).statusCode, 403);
  check(
    "membership revocation takes effect on the next request without reissuing tokens",
  );
  const ownerMembership = beforeMembers.find(
    (m: { user_id: string }) => m.user_id === adminClient.userId,
  );
  assert.equal(
    (
      await request(
        adminClient,
        "PATCH",
        base + "/members/" + ownerMembership.id,
        { status: "revoked" },
      )
    ).statusCode,
    409,
  );
  check("last administrator cannot be removed");
  assert.equal(
    (await request(reviewer, "GET", base + "/audit")).statusCode,
    403,
  );
  const history = await expectStatus(
    await request(adminClient, "GET", base + "/audit"),
    200,
  );
  assert(
    history.events.some(
      (e: { action: string }) => e.action === "shipment.updated",
    ),
  );
  await assert.rejects(
    () => pool.query("DELETE FROM audit_events"),
    (error: unknown) => (error as { code: string }).code === "42501",
  );
  check(
    "audit history is tenant scoped and runtime cannot rewrite/delete events",
  );
  const pendingRecipient = await fixtureUser("pending@example.test");
  const revokedInvite = await expectStatus(
    await request(adminClient, "POST", base + "/invitations", {
      email: "pending@example.test",
      roleId: await role(account.id, "reviewer"),
    }),
    201,
  );
  await expectStatus(
    await request(
      adminClient,
      "DELETE",
      base + "/invitations/" + revokedInvite.id,
    ),
    200,
  );
  assert.equal(
    (
      await request(pendingRecipient, "POST", "/api/invitations/accept", {
        token: new URL(revokedInvite.inviteUrl).hash.split("token=")[1],
      })
    ).statusCode,
    410,
  );
  const expiredInvite = await expectStatus(
    await request(adminClient, "POST", base + "/invitations", {
      email: "pending@example.test",
      roleId: await role(account.id, "reviewer"),
    }),
    201,
  );
  await owner.query(
    "UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expiredInvite.id],
  );
  assert.equal(
    (
      await request(pendingRecipient, "POST", "/api/invitations/accept", {
        token: new URL(expiredInvite.inviteUrl).hash.split("token=")[1],
      })
    ).statusCode,
    410,
  );
  const issuerInvite = await expectStatus(
    await request(adminClient, "POST", base + "/invitations", {
      email: "pending@example.test",
      roleId: await role(account.id, "reviewer"),
    }),
    201,
  );
  await owner.query("UPDATE users SET issuer=$1 WHERE id=$2", [
    "https://another-issuer.example",
    pendingRecipient.userId,
  ]);
  assert.equal(
    (
      await request(pendingRecipient, "POST", "/api/invitations/accept", {
        token: new URL(issuerInvite.inviteUrl).hash.split("token=")[1],
      })
    ).statusCode,
    403,
  );
  check("expired, revoked and wrong-issuer invitations are rejected");
  const partnerAdmin = await fixtureUser("partner-admin@example.test");
  await member(partnerAdmin, partner.id, "owner");
  const newAccount = await expectStatus(
    await request(partnerAdmin, "POST", `/api/tenants/${partner.id}/accounts`, {
      name: "Provisioned customer",
      ownerEmail: "customer-owner@example.test",
    }),
    201,
  );
  assert.equal(
    (
      await request(
        partnerAdmin,
        "GET",
        `/api/tenants/${newAccount.account.id}/shipments`,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        partnerAdmin,
        "DELETE",
        `/api/tenants/${partner.id}/invitations/${newAccount.invitation.id}`,
      )
    ).statusCode,
    200,
  );
  const operatorPartner = await expectStatus(
    await request(operator, "POST", "/api/platform/partners", {
      name: "Provisioned partner",
      ownerEmail: "partner-owner@example.test",
    }),
    201,
  );
  assert.equal(
    (
      await request(
        operator,
        "GET",
        `/api/tenants/${operatorPartner.id}/settings`,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        operator,
        "DELETE",
        "/api/platform/invitations/" + operatorPartner.invitation.id,
      )
    ).statusCode,
    200,
  );
  check(
    "partner/platform provisioning creates revocable invitations without implicit memberships",
  );
  const concurrencyOwner = await fixtureUser("concurrent-owner@example.test");
  const concurrentAccount = await transaction(owner, adminClient.userId, (db) =>
    createTenant(
      db,
      "account",
      "Concurrent account",
      partner.id,
      adminClient.userId,
    ),
  );
  await member(concurrencyOwner, concurrentAccount.id, "owner");
  const concurrentMembers = (
    await request(
      adminClient,
      "GET",
      `/api/tenants/${concurrentAccount.id}/members`,
    )
  ).json().members as { id: string; user_id: string }[];
  const removals = await Promise.all([
    request(
      adminClient,
      "PATCH",
      `/api/tenants/${concurrentAccount.id}/members/${concurrentMembers.find((m) => m.user_id === adminClient.userId)!.id}`,
      { status: "revoked" },
    ),
    request(
      concurrencyOwner,
      "PATCH",
      `/api/tenants/${concurrentAccount.id}/members/${concurrentMembers.find((m) => m.user_id === concurrencyOwner.userId)!.id}`,
      { status: "revoked" },
    ),
  ]);
  assert.deepEqual(removals.map((r) => r.statusCode).sort(), [200, 409]);
  check("concurrent revocations preserve the last administrator");
  const pdf = await request(
    adminClient,
    "POST",
    path + "/documents/invoice/pdf",
    { version: 2 },
  );
  assert.equal(pdf.statusCode, 200, pdf.body);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
  assert.equal(
    (
      await request(adminClient, "POST", path + "/documents/invoice/pdf", {
        version: 1,
      })
    ).statusCode,
    409,
  );
  check("authorized PDFs render persisted, version-checked snapshots");
  const docSource = await expectStatus(
    await request(adminClient, "POST", base + "/shipments", data),
    201,
  );
  const jobsPath = base + "/shipments/" + docSource.id + "/document-jobs";
  const key = crypto.randomUUID();
  const queued = await expectStatus(
    await request(adminClient, "POST", jobsPath, {
      version: 1,
      type: "invoice",
      idempotencyKey: key,
    }),
    202,
  );
  assert.equal(queued.status, "queued");
  assert.equal(
    (
      await expectStatus(
        await request(adminClient, "POST", jobsPath, {
          version: 1,
          type: "invoice",
          idempotencyKey: key,
        }),
        202,
      )
    ).id,
    queued.id,
  );
  assert.equal(
    (
      await request(adminClient, "POST", jobsPath, {
        version: 1,
        type: "packing-list",
        idempotencyKey: key,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request(adminClient, "POST", jobsPath, {
        version: 99,
        type: "invoice",
        idempotencyKey: crypto.randomUUID(),
      })
    ).statusCode,
    409,
  );
  assert.equal((await request(outsider, "GET", jobsPath)).statusCode, 403);
  assert.equal(
    (await request(external, "GET", jobsPath + "/" + queued.id + "/file"))
      .statusCode,
    403,
  );
  assert.equal(
    (await request(adminClient, "GET", jobsPath + "/" + queued.id + "/file"))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await owner.query("SELECT 1 FROM document_outbox WHERE job_id=$1", [
        queued.id,
      ])
    ).rowCount,
    1,
  );
  await expectStatus(
    await request(adminClient, "PUT", base + "/shipments/" + docSource.id, {
      version: 1,
      data: { ...data, buyerPo: "EDITED-AFTER-QUEUE" },
    }),
    200,
  );
  assert.notEqual(
    (
      await owner.query("SELECT snapshot FROM document_jobs WHERE id=$1", [
        queued.id,
      ])
    ).rows[0].snapshot.shipment.buyerPo,
    "EDITED-AFTER-QUEUE",
  );
  await assert.rejects(
    () =>
      transaction(pool, adminClient.userId, (db) =>
        db.query("UPDATE document_jobs SET html='tampered' WHERE id=$1", [
          queued.id,
        ]),
      ),
    (error: unknown) => (error as { code: string }).code === "42501",
  );
  check(
    "durable document outbox, idempotency, immutable snapshots, stale-version rejection and foreign access denial",
  );

  const failure = await expectStatus(
    await request(adminClient, "POST", jobsPath, {
      version: 2,
      type: "packing-list",
      idempotencyKey: crypto.randomUUID(),
    }),
    202,
  );
  const failedRunner = new DocumentRunner(
    pool,
    config,
    () => {},
    async () => {
      throw new Error("Simulated renderer failure");
    },
  );
  try {
    for (let i = 0; i < 3; i++)
      await failedRunner.process({
        id: failure.id,
        requester: adminClient.userId,
      });
  } finally {
    await failedRunner.close();
  }
  assert.equal(
    (
      await owner.query("SELECT status FROM document_jobs WHERE id=$1", [
        failure.id,
      ])
    ).rows[0].status,
    "failed",
  );
  assert.equal(
    (
      await owner.query("SELECT 1 FROM document_files WHERE job_id=$1", [
        failure.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await owner.query("SELECT 1 FROM document_outbox WHERE job_id=$1", [
        failure.id,
      ])
    ).rowCount,
    0,
  );
  check(
    "bounded render retries end in a durable failed state without a downloadable file",
  );

  // Simulate a crashed attempt; another delivery must reclaim its expired lease.
  await owner.query(
    "UPDATE document_jobs SET status='processing',attempts=1,lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE id=$1",
    [queued.id],
  );
  let releaseOld!: (bytes: Buffer) => void, announceStart!: () => void;
  const started = new Promise<void>((resolve) => {
    announceStart = resolve;
  });
  const oldRender = new Promise<Buffer>((resolve) => {
    releaseOld = resolve;
  });
  const obsoleteRunner = new DocumentRunner(
    pool,
    config,
    () => {},
    async () => {
      announceStart();
      return oldRender;
    },
  );
  const obsolete = obsoleteRunner.process({
    id: queued.id,
    requester: adminClient.userId,
  });
  await started;
  await owner.query(
    "UPDATE document_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [queued.id],
  );
  const expiredRunner = new DocumentRunner(
    pool,
    config,
    () => {},
    async () => pdf.rawPayload,
  );
  try {
    await expiredRunner.process({
      id: queued.id,
      requester: adminClient.userId,
    });
    await expiredRunner.process({
      id: queued.id,
      requester: adminClient.userId,
    });
  } finally {
    releaseOld(Buffer.concat([pdf.rawPayload, Buffer.from("stale-render")]));
    await obsolete;
    await obsoleteRunner.close();
    await expiredRunner.close();
  }
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::int AS n FROM document_files WHERE job_id=$1",
        [queued.id],
      )
    ).rows[0].n,
    1,
  );
  const savedPdf = await request(
    adminClient,
    "GET",
    jobsPath + "/" + queued.id + "/file",
  );
  assert.equal(savedPdf.statusCode, 200);
  assert.deepEqual(savedPdf.rawPayload, pdf.rawPayload);
  assert.equal(
    savedPdf.headers["x-document-sha256"],
    createHash("sha256").update(pdf.rawPayload).digest("hex"),
  );
  await assert.rejects(
    () =>
      transaction(pool, adminClient.userId, (db) =>
        db.query(
          "UPDATE document_files SET sha256='tampered' WHERE job_id=$1",
          [queued.id],
        ),
      ),
    (error: unknown) => (error as { code: string }).code === "42501",
  );
  check(
    "expired worker leases recover once, saved PDF hashes verify and files remain immutable",
  );

  const temporary = await fixtureUser("document-revocation@example.test");
  await member(temporary, account.id, "preparer");
  const revoked = await expectStatus(
    await request(temporary, "POST", jobsPath, {
      version: 2,
      type: "invoice",
      idempotencyKey: crypto.randomUUID(),
    }),
    202,
  );
  const revokingRunner = new DocumentRunner(
    pool,
    config,
    () => {},
    async () => {
      await owner.query(
        "UPDATE memberships SET status='revoked' WHERE user_id=$1",
        [temporary.userId],
      );
      return pdf.rawPayload;
    },
  );
  try {
    await revokingRunner.process({
      id: revoked.id,
      requester: temporary.userId,
    });
    await revokingRunner.process({
      id: revoked.id,
      requester: temporary.userId,
    });
  } finally {
    await revokingRunner.close();
  }
  assert.equal(
    (
      await owner.query("SELECT error_code FROM document_jobs WHERE id=$1", [
        revoked.id,
      ])
    ).rows[0].error_code,
    "access_revoked",
  );
  assert.equal(
    (
      await owner.query("SELECT 1 FROM document_files WHERE job_id=$1", [
        revoked.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (await request(temporary, "GET", jobsPath + "/" + queued.id + "/file"))
      .statusCode,
    403,
  );
  check(
    "access revocation during background rendering prevents file persistence and delivery",
  );

  assert.equal(
    (
      await transaction(pool, outsider.userId, (db) =>
        db.query("SELECT id FROM document_jobs"),
      )
    ).rowCount,
    0,
  );
  const reviewerJob = await expectStatus(
    await request(reviewer, "POST", jobsPath, {
      version: 2,
      type: "packing-list",
      idempotencyKey: crypto.randomUUID(),
    }),
    202,
  );
  assert.equal(reviewerJob.status, "queued");
  documentRunner.start();
  const background = await expectStatus(
    await request(adminClient, "POST", jobsPath, {
      version: 2,
      type: "invoice",
      idempotencyKey: crypto.randomUUID(),
    }),
    202,
  );
  const until = Date.now() + 30000;
  let ready = false;
  while (Date.now() < until) {
    const row = (
      await owner.query("SELECT status FROM document_jobs WHERE id=$1", [
        background.id,
      ])
    ).rows[0];
    if (
      row.status === "ready" &&
      (
        await owner.query("SELECT status FROM document_jobs WHERE id=$1", [
          reviewerJob.id,
        ])
      ).rows[0].status === "ready"
    ) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert(
    ready,
    "A real BullMQ worker must render the committed outbox request.",
  );
  assert.equal(
    (
      await request(
        adminClient,
        "GET",
        jobsPath + "/" + background.id + "/file",
      )
    ).rawPayload
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
  assert.equal(
    (await request(reviewer, "GET", jobsPath + "/" + reviewerJob.id + "/file"))
      .statusCode,
    200,
  );
  check(
    "real Redis/BullMQ dispatch renders a persisted draft outside the API request",
  );

  const mfaApp = await buildApp({ ...config, requireAdminMfa: true }, pool);
  const noMfa = await transaction(owner, null, (db) =>
    issueSession(db, adminClient.userId, ["pwd"], config),
  );
  const csrf = (
    await owner.query("SELECT csrf_token FROM sessions WHERE token_hash=$1", [
      tokenHash(noMfa),
    ])
  ).rows[0].csrf_token;
  const mfaResponse = await mfaApp.inject({
    method: "POST",
    url: base + "/roles",
    headers: {
      cookie: "freightnaut_session=" + noMfa,
      origin: config.PUBLIC_ORIGIN,
      "x-csrf-token": csrf,
    },
    payload: { name: "Needs MFA", permissions: [] },
  });
  assert.equal(mfaResponse.statusCode, 403);
  await mfaApp.close();
  check(
    "privileged changes require a verified MFA session when enforcement is enabled",
  );
  for (const invalid of ["nonce", "audience", "expired"]) {
    nextClaims = {
      subject: "invalid-" + invalid,
      email: "invalid@example.test",
      verified: true,
      invalid,
    };
    const login = await app.inject("/api/auth/login/test");
    const binder = login.cookies.find((c) => c.name === "freightnaut_login")!;
    const response = await fetch(login.headers.location!, {
      redirect: "manual",
    });
    const callback = new URL(response.headers.get("location")!);
    const rejected = await app.inject({
      url: callback.pathname + callback.search,
      headers: { cookie: "freightnaut_login=" + binder.value },
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
  }
  check("invalid nonce, audience and expired identity tokens are rejected");
  // Browser uses the same authenticated application against this disposable database.
  await app.listen({ host: "127.0.0.1", port: 0 });
  config.PUBLIC_ORIGIN = app.listeningOrigin;
  nextClaims = {
    subject: "first-admin",
    email: "admin@example.test",
    verified: true,
    invalid: "",
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(config.PUBLIC_ORIGIN);
    await page.screenshot({
      path: "../work/ui-refresh/signin.png",
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Continue with Test identity" })
      .click();
    await page.getByRole("combobox", { name: "Active workspace" }).waitFor();
    await page
      .getByRole("combobox", { name: "Active workspace" })
      .selectOption(account.id);
    await page
      .getByRole("button", { name: "New shipment", exact: true })
      .click();
    await page.getByRole("heading", { name: "Parties", exact: true }).waitFor();
    await page.locator('[id="exporter.name"]').fill("Browser exporter");
    await page.locator('[id="consignee.name"]').fill("Browser consignee");
    await page
      .getByRole("button", { name: "Goods & packages", exact: false })
      .click();
    await page.getByRole("button", { name: "Add goods line" }).click();
    await page
      .getByRole("textbox", { name: "Description line 1", exact: true })
      .fill("Browser goods");
    await page
      .getByRole("textbox", { name: "HS code line 1", exact: true })
      .fill("12345678");
    await page
      .getByRole("textbox", { name: "Unit price line 1", exact: true })
      .fill("10.25");
    await page
      .getByRole("button", { name: "Terms & transport", exact: false })
      .click();
    await page
      .getByRole("textbox", { name: "Shipment reference", exact: true })
      .fill("BROWSER-001");
    await page
      .getByRole("combobox", { name: "Origin country", exact: true })
      .selectOption("DE");
    await page
      .getByRole("combobox", {
        name: "Destination country",
        exact: true,
      })
      .selectOption("US");
    assert.equal(
      await page.locator('[id="custom.inspection_ref"]').inputValue(),
      "INS-DEFAULT",
    );
    await page.locator('[id="custom.inspection_ref"]').fill("INS-BROWSER");
    await page.getByText("Saved", { exact: true }).waitFor();
    await page.reload();
    await page.getByRole("combobox", { name: "Active workspace" }).waitFor();
    await page
      .getByRole("button", { name: "Goods & packages", exact: false })
      .click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Description line 1", exact: true })
        .inputValue(),
      "Browser goods",
    );
    await mkdir("../work/auth-verification", { recursive: true });
    await page.screenshot({
      path: "../work/auth-verification/workspace.png",
      fullPage: true,
    });
    // Navigate immediately after an edit: the pending autosave must finish first.
    await page
      .getByRole("textbox", { name: "Description line 1", exact: true })
      .fill("Browser goods saved on navigation");
    await page
      .getByRole("button", { name: "Workspace settings", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Workspace settings", exact: true })
      .waitFor();
    await page.screenshot({
      path: "../work/ui-refresh/settings.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "People & access", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "People & access", exact: true })
      .waitFor();
    await page.screenshot({
      path: "../work/ui-refresh/people.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Shipments", exact: true }).click();
    const browserRow = page.getByRole("row").filter({ hasText: "BROWSER-001" });
    await browserRow.waitFor();
    await page.screenshot({
      path: "../work/ui-refresh/shipments.png",
      fullPage: true,
    });
    await browserRow.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .getByRole("button", { name: "Goods & packages", exact: false })
      .click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Description line 1", exact: true })
        .inputValue(),
      "Browser goods saved on navigation",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .frameLocator("iframe")
      .getByText("Browser goods saved on navigation", { exact: true })
      .waitFor();
    await page.screenshot({
      path: "../work/ui-refresh/mobile.png",
      fullPage: true,
    });
    const delivered = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download draft PDF", exact: true })
      .click();
    const downloadedPdf = await delivered;
    assert.match(downloadedPdf.suggestedFilename(), /invoice-v\d+-draft\.pdf/);
    await page
      .getByRole("region", { name: "Saved draft documents" })
      .getByText("Ready to download", { exact: false })
      .waitFor();
    await page
      .getByRole("region", { name: "Saved draft documents" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "../work/ui-refresh/document-history.png" });
    await page.locator(".preview-panel").scrollIntoViewIfNeeded();
    await page
      .locator("iframe")
      .screenshot({ path: "../work/ui-refresh/mobile-document.png" });
    await page.screenshot({ path: "../work/ui-refresh/mobile-preview.png" });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
      .getByRole("heading", { name: "Welcome to Freightnaut Docs." })
      .waitFor();
    nextClaims = {
      subject: "reviewer@example.test",
      email: "reviewer@example.test",
      verified: true,
      invalid: "",
    };
    await page
      .getByRole("link", { name: "Continue with Test identity" })
      .click();
    await page
      .getByRole("heading", { name: "Your shipments", exact: true })
      .waitFor();
    await page
      .getByRole("row")
      .filter({ hasText: "BROWSER-001" })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Goods & packages", exact: false })
      .click();
    assert(
      await page
        .getByRole("textbox", { name: "Description line 1", exact: true })
        .isDisabled(),
    );
    assert.deepEqual(pageErrors, []);
    check(
      "authenticated browser: create, edit, server reload, account switch, mobile layout and reviewer read-only state",
    );
  } finally {
    await browser.close();
  }
  assert.equal(
    (
      await request(unverified, "POST", "/api/onboarding/workspace", {
        companyName: "Blocked by default",
      })
    ).statusCode,
    403,
  );
  const localSignupApp = await buildApp(
    { ...config, NODE_ENV: "development", LOCAL_SELF_SERVICE_SIGNUP: "true" },
    pool,
  );
  const signup = await localSignupApp.inject({
    method: "POST",
    url: "/api/onboarding/workspace",
    headers: {
      cookie: "freightnaut_session=" + unverified.token,
      origin: config.PUBLIC_ORIGIN,
      "x-csrf-token": unverified.csrf,
    },
    payload: { companyName: "Isolated own workspace" },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const ownId = signup.json().workspaceId;
  assert.equal(
    (await request(unverified, "GET", `/api/tenants/${ownId}/shipments`))
      .statusCode,
    200,
  );
  assert.equal(
    (await request(unverified, "GET", base + "/shipments")).statusCode,
    403,
  );
  assert.equal(
    (await request(unverified, "GET", "/api/auth/session")).json().operator,
    false,
  );
  const duplicate = await localSignupApp.inject({
    method: "POST",
    url: "/api/onboarding/workspace",
    headers: {
      cookie: "freightnaut_session=" + unverified.token,
      origin: config.PUBLIC_ORIGIN,
      "x-csrf-token": unverified.csrf,
    },
    payload: { companyName: "Duplicate workspace" },
  });
  assert.equal(duplicate.statusCode, 409);
  await localSignupApp.close();
  check(
    "local self-service creates only an isolated owned workspace, without platform access or duplicate provisioning",
  );
  const logout = await request(invitee, "POST", "/api/auth/logout");
  assert.equal(logout.statusCode, 200);
  assert.equal(
    (await request(invitee, "GET", base + "/shipments")).statusCode,
    401,
  );
  check("logout destroys server-side session");
  console.log(
    `Integration passed: ${count} security and persistence scenarios.`,
  );
} finally {
  await documentRunner.close();
  const redis = new Redis(config.REDIS_URL!, { maxRetriesPerRequest: 1 });
  const queue = new Queue(config.PDF_QUEUE_NAME, { connection: redis });
  await queue.obliterate({ force: true });
  await queue.close();
  redis.disconnect();
  await app.close();
  await issuerApp.close();
  await pool.end();
  await owner.end();
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
