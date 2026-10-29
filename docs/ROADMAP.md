# Release plan

## Implemented: identity, access and persisted customization

OIDC, server sessions, MFA-gated administration, tenant memberships, bounded custom roles, verified invitations, scoped collaborators, Postgres/RLS, versioned configuration with locks, custom fields, persisted shipment drafts, concurrency protection, audit and authorized PDFs. Local identity infrastructure is real; production Auth0 credentials have not been provisioned.

## Implemented: workspace experience

A consistent responsive workspace, self-hosted typography, branded local identity screens, focused company/trade/document/branding settings, role-aware team management, searchable shipment summaries, cursor pagination and authorized shipment copying. Shipment edits flush before navigation; selected records survive reloads. Configuration keeps explicit saves and unsaved-change protection. Metrics and readiness come from persisted authorized records; the app seeds no customer examples.

## Implemented: background draft lifecycle

A separate BullMQ worker consumes a durable Postgres outbox. Draft requests save version-checked shipment/settings/HTML snapshots and requester-scoped idempotency keys. Bounded retries and lease recovery retain failed status. Immutable saved PDF bytes and SHA-256 hashes remain private in Postgres. The UI shows history, statuses and re-downloads; current permissions are checked before processing, persistence and every download.

## Next: numbering, private object storage and issuance

Move large artifacts to private object storage with authorized expiring downloads. Add transactional document numbering, amendment reasons and retained originals, rule/template publishing and a reviewed live-issuance policy. A failed render cannot reuse an allocated number or report a successful issuance. Current background jobs generate drafts only.

## Then: domain-validated rules and customization

Versioned JSON Schema rule packs, explicit conflict/precedence semantics, effective dates and reviewed sources. Add buyer/shipment configuration APIs, template/table configuration and language handling. Make publishing distinct from editing, with representative rendering fixtures, impact review and rollback. Add approvals/signature policy and audit before enabling live issue.

## Partner integration

Scoped/revocable service credentials, authenticated embed sessions, signing/retry for webhooks, integration quickstarts, developer logs with masking, request quotas and usage limits. Each credential type must carry its own tenant/action scope; human sessions are not reused as integration tokens.

## Production release gate

Configure the production Auth0 tenant and MFA; independently test deployment, RLS/tenant isolation, object storage, backups and restore, migrations, monitoring, security headers, CSP, translations, disaster recovery and concurrency. Release only when the complete document lifecycle is proven; this repository does not label draft generation as live issuance.
