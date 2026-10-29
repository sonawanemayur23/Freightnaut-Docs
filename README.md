# Freightnaut Docs

Export document workspace built with React, Fastify, TypeScript, Postgres and Chromium. Identity is verified using OpenID Connect; application permissions belong to tenant memberships and explicit shipment grants.

## Current implementation

- OIDC Authorization Code + PKCE, state, nonce and signed-token validation.
- HttpOnly server-side sessions, CSRF/origin checks, absolute/idle expiry and logout.
- Separate platform operator, partner administrator/developer, account administrator/preparer/reviewer, and external collaborator access.
- Database-backed custom roles constrained by tenant scope and the granting administrator’s permissions.
- Verified-email and issuer-bound, single-use, expiring invitations with revocation.
- Persisted shipment drafts, optimistic concurrency, configurable validation, invoice/packing-list previews and authorized draft PDFs.
- Versioned partner/account settings, inheritance, locks, reset, currency/locale/time zone, exporter defaults, document wording and typed custom shipment fields.
- Postgres row security on shipments, settings history and audit events. Runtime cannot update/delete audit history or grant itself platform operator status.
- Real Postgres and signed OIDC integration tests plus authenticated browser checks.

This is a production-oriented foundation, **not yet cleared for live document issuance**. The remaining release gates are explicit in [docs/ROADMAP.md](docs/ROADMAP.md). No production authentication bypass or sample-company seed exists.

## Local setup

Node 24 and Docker Desktop are required. From this repository:

```sh
npm ci
npm run setup:local
# Starts only loopback-bound local services, with generated credentials.
docker compose up -d
npm run db:migrate
npm run browser:install
npm run dev
```

Open http://127.0.0.1:5173 using this exact hostname. Keycloak: http://127.0.0.1:8080. Local verification emails: http://127.0.0.1:8025. `setup:local` refuses to overwrite an existing `.env`. Secrets live only in ignored `.env` and `.local/` files. Local Keycloak runs in development mode and administrative MFA enforcement is explicitly disabled locally; production configuration rejects that setting.

Sign in, or register through the local identity service, then verify your address using the local mail viewer. New identities have **no workspace access**. To provision the first verified administrator, copy the account identifier displayed on the signed-in access-pending screen, then run:

```sh
npm run admin:bootstrap -- --user-id YOUR_USER_UUID --partner-name "Your partner" --account-name "Your account" --operator
```

This offline command uses the migration credential and writes bootstrap audit events. It explicitly grants the selected user the requested scopes. Ordinary partner/account creation uses first-administrator invitations; it does not grant the creator customer data access. The app never chooses your business name, profile, lane, or user identity for you.

The first administrator can configure the workspace, create shipments, invite staff, define roles, and share individual shipments. Invitations are copyable links; the app does not send emails on your behalf. Existing sample browser-local drafts are not automatically imported into a real account.

## Verify

```sh
npm test
npm run build
npm run test:integration
npm run test:smoke  # requires npm run dev
npm run test:oidc   # real local Keycloak, disposable identity, requires npm run dev
npm run format:check
```

Integration tests create and drop a uniquely named database on the **local** Postgres server. They use an isolated signed OIDC test issuer; no test login endpoint or identity override exists in the running app. They require the locally generated migration credential, Chromium and a built web bundle. Do not point them at production.

## Production configuration

Auth0 is the selected managed identity service. Use a Regular Web Application, enable MFA, and register `https://YOUR_HOST/api/auth/callback` as its callback. Configure `OIDC_PROVIDERS` with the issuer, client ID and secret. Password recovery and verification stay with the identity provider. The app does not derive application privileges from identity-provider role claims or email domains.

Set `NODE_ENV=production`, `PUBLIC_ORIGIN=https://YOUR_HOST`, `DB_SSL=true`, `REQUIRE_ADMIN_MFA=true` and the restricted runtime `DATABASE_URL`. Supply secrets through deployment secret management. Keep the migration credential **out of the runtime environment**. Run migrations in a separate administrative job with `MIGRATION_DATABASE_URL` and `APP_DATABASE_ROLE`. Use your managed database’s trusted CA when needed; certificate verification is never disabled in production.

```sh
npm run build
npm start
```

The compiled API serves the web bundle from `apps/web/dist`. A TLS reverse proxy must expose the application on the configured origin; the application does not trust arbitrary forwarded headers. `API_HOST` and `API_PORT` are deployment settings. See [docs/AUTHORIZATION.md](docs/AUTHORIZATION.md) for permissions, MFA requirements, security boundaries and remaining operational work.

## Repository

- `apps/api/src/auth`: OIDC and database-backed sessions.
- `apps/api/src/tenancy`: memberships, roles, invitations, settings and audit.
- `apps/api/src/shipments`: tenant-scoped draft APIs and document access.
- `apps/api/migrations`: ordered migrations; production API refuses privileged runtime DB roles.
- `apps/web/src`: sign-in, permission-aware navigation, shipment workflow and administration screens.
- `packages/domain`: validated data/configuration, permission catalog, calculations, rendering and settings resolver.
- `docs/openapi.json`: API contract generated from shared schemas with operation-level security requirements.
- `compose.yaml`: local Postgres, Redis, Keycloak and mail testing. Redis is prepared for the next worker milestone; it is not yet used for PDF jobs.
