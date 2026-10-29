import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { HttpError, assert } from "../errors.js";
export const randomToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export interface Actor {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  issuer: string;
  subject: string;
  sessionHash: string;
  csrfToken: string;
  amr: string[];
  mfa: boolean;
  operator: boolean;
}
export function cookieNames(config: AppConfig) {
  const prefix = config.secureCookies ? "__Host-" : "";
  return {
    session: prefix + "freightnaut_session",
    login: prefix + "freightnaut_login",
  };
}
export async function getActor(
  pool: Pool,
  request: FastifyRequest,
  config: AppConfig,
): Promise<Actor | null> {
  const token = request.cookies[cookieNames(config).session];
  if (!token || token.length > 128) return null;
  const result = await pool.query(
    `UPDATE sessions s SET last_seen_at=now() FROM users u
 WHERE s.token_hash=$1 AND s.user_id=u.id AND NOT u.disabled AND s.expires_at>now() AND s.last_seen_at>now()-($2::integer * interval '1 second')
 RETURNING u.id,u.email,u.email_verified,u.name,u.issuer,u.subject,s.token_hash,s.csrf_token,s.amr,EXISTS(SELECT 1 FROM operators o WHERE o.user_id=u.id) AS operator`,
    [tokenHash(token), config.SESSION_IDLE_SECONDS],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    issuer: row.issuer,
    subject: row.subject,
    sessionHash: row.token_hash,
    csrfToken: row.csrf_token,
    amr: row.amr,
    mfa: row.amr.includes("mfa"),
    operator: row.operator,
  };
}
export function requireActor(actor: Actor | null): Actor {
  assert(actor, 401, "Sign in to continue.");
  return actor;
}
export function requireCsrf(
  request: FastifyRequest,
  actor: Actor,
  config: AppConfig,
) {
  assert(
    request.headers.origin === config.PUBLIC_ORIGIN,
    403,
    "Request origin is not allowed.",
  );
  const token = request.headers["x-csrf-token"];
  assert(
    typeof token === "string" && equal(token, actor.csrfToken),
    403,
    "Your security token is missing or expired. Refresh and retry.",
  );
}
export function requireMfa(actor: Actor, config: AppConfig) {
  if (config.requireAdminMfa && !actor.mfa)
    throw new HttpError(
      403,
      "Multi-factor authentication is required for administrative changes. Sign in again after enabling MFA.",
    );
}
export async function issueSession(
  client: PoolClient,
  userId: string,
  amr: string[],
  config: AppConfig,
) {
  const token = randomToken();
  const csrf = randomToken();
  await client.query(
    "INSERT INTO sessions(token_hash,user_id,csrf_token,amr,expires_at) VALUES($1,$2,$3,$4,now()+($5::integer * interval '1 second'))",
    [tokenHash(token), userId, csrf, amr, config.SESSION_TTL_SECONDS],
  );
  return token;
}
