# Implementation roadmap

## 1. Current local slice

Editable shipment → shared validation → two document previews → Chromium draft PDFs.
Acceptance: sample invoice total USD 23,952.00; packing list excludes prices; invalid goods/weights identify field paths; untrusted values are escaped; malformed HTTP payloads are rejected.

## 2. Persisted, isolated pilot

Introduce Postgres migrations for partners, accounts, memberships, shipments, document sets and immutable document versions. Derive tenant scope from authenticated membership, never from arbitrary client IDs. Verify isolation in integration tests. Add API draft CRUD and optimistic concurrency before replacing browser persistence. Keep browser preview derived from the same domain renderer.

## 3. Reliable rendering and issuance

Move Chromium to a bounded BullMQ worker. Postgres owns job status and an outbox so enqueue failure cannot lose work. Retry by stable job key. Private object storage holds outputs/assets; signed downloads require account authorization. Implement transactional series allocation, idempotent issue requests, warning acknowledgements, immutable input/template/rule snapshots, file hashes and amendments. Failed rendering must not allow a reserved number to be reused.

## 4. Controlled customization

Versioned template configuration: logo, labels, declarations, columns and widths. Define the five-level resolver and lock semantics in tests before exposing overrides. Published versions are immutable; rollback creates a new published version. Keep all templates code-owned until rendering contracts are stable.

## 5. Partner integration

Scoped API keys, signed webhooks with durable delivery records, authenticated iframe session, theme tokens and quickstart. Launch one reviewed lane with Qubictron before adding countries or a freeform canvas.

## Non-goals for this slice

Live issuance, global compliance claims, AI imports, arbitrary executable formulas, a freeform editor, production hosting and billing.
