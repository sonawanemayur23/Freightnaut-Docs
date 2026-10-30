import { z } from "zod";
const providerSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(100),
  issuer: z.url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
const schema = z.object({
  LOCAL_SELF_SERVICE_SIGNUP: z.enum(["true", "false"]).default("false"),
  SERVE_WEB: z.enum(["true", "false"]).default("false"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default("127.0.0.1"),
  PUBLIC_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  OIDC_PROVIDERS: z
    .string()
    .transform((s) => JSON.parse(s))
    .pipe(z.array(providerSchema).min(1)),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86400)
    .default(28800),
  SESSION_IDLE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86400)
    .default(1800),
  REQUIRE_ADMIN_MFA: z.enum(["true", "false"]).default("true"),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(5).max(500).default(30),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  DOCUMENT_STORAGE: z.enum(["postgres", "s3"]).default("postgres"),
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  REDIS_URL: z.url().optional(),
  PDF_QUEUE_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .default("freightnaut-pdf"),
  PDF_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  PDF_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  DB_SSL: z.enum(["true", "false"]).default("true"),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error", "silent"])
    .default("info"),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);
  if (parsed.DOCUMENT_STORAGE === "s3" && !parsed.S3_BUCKET)
    throw new Error("S3_BUCKET is required for S3 document storage");
  if (Boolean(parsed.S3_ACCESS_KEY_ID) !== Boolean(parsed.S3_SECRET_ACCESS_KEY))
    throw new Error(
      "Supply both S3 credentials or use the AWS workload identity chain",
    );
  if (parsed.S3_ENDPOINT) {
    const endpoint = new URL(parsed.S3_ENDPOINT);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/"
    )
      throw new Error("S3_ENDPOINT must be an origin without credentials");
    if (
      endpoint.protocol !== "https:" &&
      !(
        parsed.NODE_ENV !== "production" &&
        endpoint.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
      )
    )
      throw new Error(
        "Object storage requires HTTPS except loopback development",
      );
  }
  const database = new URL(parsed.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(database.protocol))
    throw new Error("DATABASE_URL must use the Postgres protocol");
  if (
    parsed.NODE_ENV === "production" &&
    Array.from(database.searchParams.keys()).some((key) =>
      key.startsWith("ssl"),
    )
  )
    throw new Error(
      "Configure database TLS through DB_SSL and the system CA trust store, not URL overrides",
    );
  if (parsed.REDIS_URL) {
    const redis = new URL(parsed.REDIS_URL);
    if (!["redis:", "rediss:"].includes(redis.protocol))
      throw new Error("REDIS_URL requires Redis protocol");
    if (parsed.NODE_ENV === "production" && redis.protocol !== "rediss:")
      throw new Error("Redis TLS is required in production");
  }
  const origin = new URL(parsed.PUBLIC_ORIGIN);
  if (
    origin.origin !== parsed.PUBLIC_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw new Error(
      "PUBLIC_ORIGIN must be an origin with no path, credentials, or trailing slash",
    );
  if (
    new Set(parsed.OIDC_PROVIDERS.map((p) => p.id)).size !==
    parsed.OIDC_PROVIDERS.length
  )
    throw new Error("Provider IDs must be unique");
  const local = (url: URL) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    parsed.LOCAL_SELF_SERVICE_SIGNUP === "true" &&
    (parsed.NODE_ENV !== "development" ||
      !local(origin) ||
      !local(database) ||
      parsed.OIDC_PROVIDERS.some(
        (provider) => !local(new URL(provider.issuer)),
      ))
  )
    throw new Error(
      "Local self-service signup requires development mode and loopback-only app, database and identity provider.",
    );
  for (const provider of parsed.OIDC_PROVIDERS) {
    const issuer = new URL(provider.issuer);
    if (issuer.username || issuer.password || issuer.search || issuer.hash)
      throw new Error("Invalid issuer");
    if (
      issuer.protocol !== "https:" &&
      !(
        parsed.NODE_ENV !== "production" &&
        issuer.protocol === "http:" &&
        local(issuer)
      )
    )
      throw new Error("OIDC issuers require HTTPS (except local development)");
  }
  if (
    origin.protocol !== "https:" &&
    !(
      parsed.NODE_ENV !== "production" &&
      origin.protocol === "http:" &&
      local(origin)
    )
  )
    throw new Error("PUBLIC_ORIGIN requires HTTPS");
  if (parsed.NODE_ENV === "production" && parsed.REQUIRE_ADMIN_MFA !== "true")
    throw new Error("Administrative MFA is required in production");
  if (parsed.NODE_ENV === "production" && parsed.DB_SSL !== "true")
    throw new Error("Database TLS is required in production");
  return {
    ...parsed,
    secureCookies: origin.protocol === "https:",
    requireAdminMfa: parsed.REQUIRE_ADMIN_MFA === "true",
  };
}
export type AppConfig = ReturnType<typeof loadConfig>;
