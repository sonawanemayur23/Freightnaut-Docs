# Freightnaut Docs

Local pilot of the shipment-to-document workflow. TypeScript workspace with React/Vite, Fastify, shared Zod contracts, decimal calculations and Chromium PDF generation.

## Run

Requires Node 22.12+ (tested with Node 24).

```sh
npm install
npm run browser:install
npm run dev
```

Open http://localhost:5173. API: http://127.0.0.1:3001/api/health.

```sh
npm test
npm run build
```

## What works

- Four-step shipment workspace seeded with the India–UAE sample.
- Edit parties, goods, packages, weights, references and terms.
- Shared data powers invoice and packing-list previews.
- Actionable pilot checks and exact decimal money calculations.
- Chromium downloads of bilingual-labelled test draft PDFs.
- Local browser draft saving with schema validation on restore.
- Responsive interface and keyboard-accessible fields.

## Boundaries

This is a local prototype, not a production service. It binds to loopback. No authentication, account isolation, production persistence, live issuance, approvals, certified compliance pack, or BullMQ worker exists yet. Drafts are saved only in browser storage and are not encrypted; use sample data. PDF jobs currently run synchronously in the API. Local Postgres and Redis infrastructure is provided for the next milestone, but the app does not use it yet.

English–Arabic labels are an initial rendering sample, not a professionally reviewed translation. The packing list currently has shipment-level package totals, not carton allocation. All files remain TEST DRAFT.

## Structure

- `apps/web`: React shipment workspace.
- `apps/api`: local Fastify API and Chromium draft renderer.
- `packages/domain`: canonical schema, calculations, sample, validation and shared HTML templates.
- `docs/openapi.json`: API contract (generated from the shared shipment schema).
- `compose.yaml`: optional local Postgres and Redis.
- `docs/ROADMAP.md`: next implementation milestones.

`npm run build` checks TypeScript and produces the web bundle; the API currently runs with tsx. There is no production deployment configuration yet.
