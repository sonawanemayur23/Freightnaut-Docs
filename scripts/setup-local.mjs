import { randomBytes } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
const secret = () => randomBytes(32).toString("hex");
try {
  await access(".env");
  throw new Error(".env already exists. It has not been changed.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const ownerPassword = secret(),
  appPassword = secret(),
  clientSecret = secret(),
  adminPassword = secret(),
  redisPassword = secret();
const origin = process.env.LOCAL_PUBLIC_ORIGIN ?? "http://127.0.0.1:5173";
const providers = [
  {
    id: "local",
    name: "Workspace sign-in",
    issuer: "http://127.0.0.1:8080/realms/freightnaut",
    clientId: "freightnaut-web",
    clientSecret,
  },
];
await mkdir(".local/keycloak", { recursive: true });
const realm = {
  realm: "freightnaut",
  loginTheme: "freightnaut",
  displayName: "Freightnaut Docs",
  enabled: true,
  registrationAllowed: true,
  registrationEmailAsUsername: true,
  loginWithEmailAllowed: true,
  resetPasswordAllowed: true,
  verifyEmail: false,
  bruteForceProtected: true,
  failureFactor: 5,
  rememberMe: false,
  sslRequired: "external",
  smtpServer: {
    host: "mailpit",
    port: "1025",
    from: "workspace@freightnaut.local",
    fromDisplayName: "Freightnaut local development",
  },
  clients: [
    {
      clientId: "freightnaut-web",
      name: "Freightnaut Docs",
      enabled: true,
      publicClient: false,
      secret: clientSecret,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: [origin + "/api/auth/callback"],
      webOrigins: [origin],
      attributes: {
        "pkce.code.challenge.method": "S256",
        "post.logout.redirect.uris": origin + "/*",
      },
    },
  ],
};
await writeFile(".local/keycloak/realm.json", JSON.stringify(realm, null, 2), {
  mode: 0o600,
});
const env = {
  NODE_ENV: "development",
  LOCAL_SELF_SERVICE_SIGNUP: "true",
  API_HOST: "127.0.0.1",
  API_PORT: "3001",
  PUBLIC_ORIGIN: origin,
  DATABASE_URL: `postgres://freightnaut_app:${appPassword}@127.0.0.1:55432/freightnaut`,
  MIGRATION_DATABASE_URL: `postgres://freightnaut_owner:${ownerPassword}@127.0.0.1:55432/freightnaut`,
  APP_DATABASE_ROLE: "freightnaut_app",
  DB_SSL: "false",
  REQUIRE_ADMIN_MFA: "false",
  OIDC_PROVIDERS: JSON.stringify(providers),
  POSTGRES_USER: "freightnaut_owner",
  POSTGRES_PASSWORD: ownerPassword,
  POSTGRES_DB: "freightnaut",
  APP_DB_PASSWORD: appPassword,
  KEYCLOAK_ADMIN_USER: "local-admin",
  KEYCLOAK_ADMIN_PASSWORD: adminPassword,
  REDIS_PASSWORD: redisPassword,
  REDIS_URL: `redis://:${redisPassword}@127.0.0.1:56379`,
  LOG_LEVEL: "info",
};
await writeFile(
  ".env",
  Object.entries(env)
    .map(([key, value]) => key + "=" + value)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "Created .env and local OIDC realm with generated secrets. No users or customer data were seeded. Local MFA enforcement is off; production enforces it.",
);
