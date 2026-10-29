# Release plan

## Implemented: identity, access and persisted customization

OIDC, server sessions, MFA-gated administration, tenant memberships, bounded custom roles, verified invitations, scoped collaborators, Postgres/RLS, versioned configuration with locks, custom fields, persisted shipment drafts, concurrency protection, audit and authorized PDFs. Local identity infrastructure is real; production Auth0 credentials have not been provisioned.

## Next: document lifecycle and jobs

Move Chromium into a bounded BullMQ worker. Persist job state and an outbox in Postgres; use idempotent job/issue keys. Store files privately with authorized expiring downloads. Introduce transactional document numbering, immutable input/template/rule snapshots, PDF hashes, amendment reasons and retained originals. A failed render cannot reuse an allocated number or report a successful issuance.

## Then: domain-validated rules and customization

Versioned JSON Schema rule packs, explicit conflict/precedence semantics, effective dates and reviewed sources. Add buyer/shipment configuration APIs, template/table configuration and language handling. Make publishing distinct from editing, with representative rendering fixtures, impact review and rollback. Add approvals/signature policy and audit before enabling live issue.

## Partner integration

Scoped/revocable service credentials, authenticated embed sessions, signing/retry for webhooks, integration quickstarts, developer logs with masking, request quotas and usage limits. Each credential type must carry its own tenant/action scope; human sessions are not reused as integration tokens.

## Production release gate

Configure the production Auth0 tenant and MFA; independently test deployment, RLS/tenant isolation, object storage, backups and restore, migrations, monitoring, security headers, CSP, translations, disaster recovery and concurrency. Release only when the complete document lifecycle is proven; this repository does not label draft generation as live issuance.
