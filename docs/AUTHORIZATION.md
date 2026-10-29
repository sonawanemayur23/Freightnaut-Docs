# Identity, permissions and customization

## Decision

Use managed Auth0 for production identity and standards-based OIDC in the application. Local development uses Keycloak through the same protocol. This keeps credential storage, recovery and MFA with the identity service while keeping the partner/account authorization model in Freightnaut. There is no separate password database or development login bypass.

A person is identified by `(issuer, subject)`. Equal email addresses do not merge identities. Signing in creates an identity and session, not an account membership. Issuer configuration is server-owned; arbitrary issuers cannot be supplied by the browser. Invitations bind the verified email **and** inviter’s configured issuer. Federation into a common Auth0 issuer must preserve Auth0’s email-verification trust guarantees.

## Persona boundaries

| Persona               | Scope           | Current access                                                                                      |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| Freightnaut operator  | Platform        | Create partners and invite their administrators; no implicit tenant shipment access                 |
| Partner administrator | One partner     | Customer account provisioning, partner settings, roles, invitations and audit                       |
| Partner developer     | One partner     | Partner audit visibility; API key/webhook management comes with the integration milestone           |
| Account administrator | One account     | Settings, roles, membership, audit, shipment read/write and draft download                          |
| Document preparer     | One account     | Shipment read/write and draft download                                                              |
| Reviewer              | One account     | Shipment read and draft download; approval workflow is not implemented yet                          |
| External collaborator | Named shipments | Explicit read, optional download, expiry and revocation; no account listing, editing or team access |

Persona names seed roles at tenant creation. Authorization checks **permissions**, not role names. An administrator may customize non-reserved roles or create narrower roles. The reserved administrator role provides a recovery path and cannot be edited away. Removing/demoting the last active reserved administrator is blocked under a transaction lock. Roles and memberships reference the same tenant through composite foreign keys.

A partner role does not flow into customer account membership. One person can have different roles in different partners/accounts. Service credentials, embed sessions, support impersonation and anonymous sharing do not silently reuse human privileges; they are not enabled until their own scoped mechanisms are built.

## Request boundary

1. Verify a random HttpOnly session cookie against its SHA-256 hash in Postgres.
2. Check user status, absolute expiry and idle expiry; derive identity server-side.
3. For mutations, require the exact configured `Origin` and a constant-time checked CSRF token.
4. Look up the current active membership, role, tenant/parent state, and expiry on every request. Never accept actor IDs, role names or tenant access claims from client input.
5. Require the action permission and a verified `amr: mfa` claim for administrative mutations when MFA enforcement is enabled. Production refuses to start with enforcement disabled.
6. For resource operations, validate both tenant and resource IDs; set the verified actor using transaction-local Postgres context. RLS independently checks the resource permission.
7. Commit the database transaction before returning success. Audit events are written in the same transaction.

Session cookies use `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and a `__Host-` prefix over HTTPS. OIDC transactions are short-lived, cookie-bound and consumed once. PKCE verifier, state and nonce remain server-side. ID-token signature, issuer, audience, expiry and nonce are checked by `openid-client`; provider tokens are discarded after identity verification. No access/refresh token or shipment draft is saved in browser-local storage.

Defaults: eight-hour absolute sessions, 30-minute idle expiry, ten-minute OIDC transactions and 48-hour invitations/grants. These limits are validated server configuration. Revoking a membership or grant is effective on the next authorization check. Logout deletes the current session. Disabling a user in the application database blocks all their sessions. Identity-provider disable/logout is not yet pushed into the application through back-channel logout; application sessions otherwise expire at their configured bounds.

Invitations are hashed at rest, shown once, expire, can be revoked, and are redeemed only by the invited verified identity. Redemption rechecks that the inviter remains authorized, and does not overwrite an existing active membership. Tokens are placed in URL fragments, removed from browser history immediately, and temporarily retained in session storage only to survive the identity redirect; they are never logged or sent as URL query parameters.

## Database boundary

The runtime role must be neither superuser nor `BYPASSRLS`. Migrations run separately. Shipment tables use `ENABLE` and `FORCE ROW LEVEL SECURITY`; reads, inserts and updates have action-specific policies. Settings history and tenant audit reads are scoped too. Missing transaction context denies resource access.

Membership/identity/tenant metadata is application-authorized and not RLS protected, avoiding recursive policy evaluation. The runtime DB role is a trusted backend credential; RLS is defense against missing/incorrect resource predicates, not a sandbox for a compromised server or arbitrary SQL execution. Runtime cannot rewrite/delete audit/settings history, mutate operator assignments, or disable/reenable users. Database operators remain privileged and need an operational audit/retention policy.

Production database connections verify TLS certificates. SQL values are parameterized; clients cannot supply SQL identifiers. Migration role names are validated before identifier interpolation.

## Configuration boundary

Business settings belong to versioned tenant records: brand colors/name, locale/time zone, currency, lane defaults, Incoterms, exporter profile, package/unit labels, HS length, buyer reference requirement, document titles, secondary titles, declarations and typed custom fields.

The shared resolver supports Base → Partner → Account → Buyer → Shipment in that order. This release exposes persisted **partner/account** configuration. Buyer/shipment configuration APIs and the full template canvas are not implemented. Settings merge at the named setting boundary (object/array settings are atomic), with source/lock provenance. Account APIs reject attempts to override partner locks. New parent locks take precedence over older descendant overrides without corrupting the resolved configuration. Saved revisions prevent concurrent administrators overwriting one another.

Custom fields support text, number, date, choice and checkbox inputs, required flags, help, defaults and hiding. Their keys bind form values, validation and escaped document output. Published keys/types cannot be removed/changed: hide an old field and create another to preserve existing draft values. This is not an arbitrary code/formula engine. Layout, field-level translations, country-specific compliance packs and workflow customization remain separate milestones.

Security policies, tenant ownership and action permissions are enforced constraints. They cannot be switched off as customer preferences. Template content is escaped; colors and configuration use bounded schemas, not arbitrary HTML/CSS or executable formulas. Chromium blocks network requests and JavaScript; rendering is currently bounded and time-limited inside the API process. Background queue processing and immutable issuance remain release gates.

## Operational limits before release

- Connect and verify the actual Auth0 tenant, MFA, password/email policies, key rotation and recovery procedures.
- Introduce durable BullMQ jobs/outbox and private object storage, then transactional numbering, immutable issuance and amendments.
- Add signed partner API credentials, webhook delivery and independently scoped embeds.
- Validate translations and lane rules with domain reviewers. Generic data validation is not a compliance certification.
- Test the deployed TLS proxy, CSP, backup restoration, database privileges, monitoring and error reporting. Rate limits are process-local; use a shared store before multiple API replicas.
- Add identity-provider back-channel logout and administrator session management before requiring immediate IdP-wide revocation.

Sources consulted: [openid-client](https://github.com/panva/openid-client), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Keycloak local containers](https://www.keycloak.org/server/containers), [Auth0 MFA](https://auth0.com/docs/secure/multi-factor-authentication).
