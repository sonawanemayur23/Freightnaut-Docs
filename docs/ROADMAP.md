# Release plan

## Implemented: identity, access and persisted customization

OIDC, server sessions, MFA-gated administration, tenant memberships, bounded custom roles, verified invitations, scoped collaborators, Postgres/RLS, versioned configuration with locks, custom fields, persisted shipment drafts, concurrency protection, audit and authorized PDFs. Local identity infrastructure is real; production Auth0 credentials have not been provisioned.

## Implemented: workspace experience

A consistent responsive workspace, self-hosted typography, branded local identity screens, focused company/trade/document/branding settings, role-aware team management, searchable shipment summaries, cursor pagination and authorized shipment copying. Shipment edits flush before navigation; selected records survive reloads. Configuration keeps explicit saves and unsaved-change protection. Metrics and readiness come from persisted authorized records; the app seeds no customer examples.

## Implemented: background draft lifecycle

A separate BullMQ worker consumes a durable Postgres outbox. Draft requests save version-checked shipment/settings/HTML snapshots and requester-scoped idempotency keys. Bounded retries and lease recovery retain failed status. Immutable file manifests and SHA-256 hashes remain in Postgres; new PDFs can be held in private object storage. The UI shows history, statuses and re-downloads; current permissions are checked before processing, persistence and every download.

## Implemented: private PDF storage

S3-compatible private writes, conditional creation, bounded and hash-verified reads, retained object version IDs, and authorization/session rechecks before delivery. Existing Postgres bytes are preserved. Local SeaweedFS runs on loopback; a private versioned AWS bucket/IAM template is provided for later deployment. No raw object URLs are exposed. Orphan reconciliation and storage backup/retention operations remain release work.

## Implemented: configurable number reservations

Account-owned series, branches, configurable resets and timezone-aware periods, transactional counters and idempotency. Permissions and MFA guard reservations and voids; retained history includes void reasons and configuration snapshots. Prepared drafts capture a reservation without becoming issued documents. Existing references and files are preserved.

## Next: approvals and issuance

Add approval policy and controlled issue transitions, amendment reasons and retained originals, rule/template publishing and a reviewed live-issuance policy. A failed render cannot reuse an allocated number or report a successful issuance. Current background jobs generate drafts only.

## Then: domain-validated rules and customization

Versioned JSON Schema rule packs, explicit conflict/precedence semantics, effective dates and reviewed sources. Add buyer/shipment configuration APIs, template/table configuration and language handling. Make publishing distinct from editing, with representative rendering fixtures, impact review and rollback. Add approvals/signature policy and audit before enabling live issue.

## Partner integration

Scoped/revocable service credentials, authenticated embed sessions, signing/retry for webhooks, integration quickstarts, developer logs with masking, request quotas and usage limits. Each credential type must carry its own tenant/action scope; human sessions are not reused as integration tokens.

## Production release gate

Configure the production Auth0 tenant and MFA; independently test deployment, RLS/tenant isolation, object storage, backups and restore, migrations, monitoring, security headers, CSP, translations, disaster recovery and concurrency. Release only when the complete document lifecycle is proven; this repository does not label draft generation as live issuance.
