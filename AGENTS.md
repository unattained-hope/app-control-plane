# AGENTS.md — Apoaap Control Plane

Instructions for AI coding agents working in this repository.

## Overview

Internal multi-app admin for the Apoaap Shopify-app portfolio. MVP is operational for one tenant (**SaleSwitch**) with a connector seam so app #2 is a config change, not a rewrite.

This is a **standalone application** — it does not import or modify Badgy/SaleSwitch source. Merchant business data is read live from each app's read-replica via `AppConnector`; the control plane owns its **own** PostgreSQL for users, conversations, audit, rollups, and ops state.

OpenSpec change history lives under `openspec/changes/` (tier0–tier3). The original MVP spec is referenced from the `badgey` repo as `admin-control-plane-mvp`.

## Stack

- **Runtime:** Node 20+, React Router 7 (framework mode, persistent Express server)
- **API:** tRPC v11 (server-side RBAC via CASL)
- **Data:** Prisma 6 + PostgreSQL (control-plane DB); read-replica access via connectors
- **Auth:** WorkOS AuthKit SSO (dev stub via header/cookie identity)
- **Realtime:** Socket.IO + Redis adapter
- **Jobs:** BullMQ + Redis (KPI/ops/growth rollups, webhooks, SLA/compliance sweeps)
- **UI:** shadcn-style components, Tremor, TanStack Table/Query, Tailwind
- **Tests:** Vitest (invariant suite), Playwright (e2e)

## Repository layout

```
app/
  routes/           # React Router pages + resource routes (webhooks, metrics, api/*)
  routes.ts         # Route map — add new UI routes here under _shell layout
  components/       # Shared UI
  lib/              # Client-safe + shared utilities (config, trpc client, theme, PII helpers)
  server/
    auth.ts         # WorkOS adapter + dev identity seam
    db.ts           # Prisma client (control-plane DB only)
    rbac.ts         # CASL ability definitions — source of truth for permissions
    trpc/           # Routers + core middleware (authedProcedure, requireAbility)
    connectors/     # AppConnector registry + per-app read modules
    services/       # Business logic (one concern per file)
    workers/        # BullMQ job processors + schedulers
    realtime/       # Socket.IO gateway, presence, session tokens
prisma/             # Control-plane schema, migrations, seed
test/               # Vitest invariant tests (RBAC, replica routing, connectors, etc.)
e2e/                # Playwright specs
docs/               # Feature-specific runbooks (webhooks, SLO, feature flags, …)
openspec/changes/   # Tiered design specs and task lists
scripts/            # Architecture lint guard, dev helpers
server/start.js     # Production entry — persistent HTTP + tRPC + Socket.IO + workers
```

## Architecture invariants (do not violate)

These are enforced by lint/tests and are non-negotiable:

1. **`process.env` only in `app/lib/config.ts`.** Everywhere else imports `config`. The lint script (`scripts/check-no-app-db-writes.mjs`) fails CI on violations.

2. **Replica-only reads for merchant data.** All app data flows through `getConnector(appKey)` → `AppConnector`. No raw SQL in `app/server/connectors/` (bypasses replica routing). Proven by `test/replica-routing.test.ts`.

3. **Same-transaction audit.** Merchant actions, role changes, PII reveals, and similar side effects must write an `AuditLog` row in the **same Prisma transaction** as the effect. Audit log is append-only — no update/delete paths.

4. **Server-side RBAC.** Use `requireAbility(action)` in tRPC routers. UI gating is cosmetic. Roles: `ADMIN`, `SUPPORT`, `VIEWER` — see matrix in `app/server/rbac.ts`.

5. **Multi-app seam.** Onboarding app #2 = one connector builder in `app/server/connectors/registry.ts` + one `App` registry row. No core route/service edits. Proven by `test/stub-connector.test.ts`.

6. **Dashboard from rollups.** KPI/ops/growth tiles read pre-aggregated snapshot rows refreshed by BullMQ jobs — never live joins on production replica data for aggregates.

7. **Control plane never writes to app production DBs.** Writes go to the control-plane DB or to external APIs (Shopify, SaleSwitch admin API when configured).

## Key commands

| Action | Command |
|--------|---------|
| Install | `npm install` |
| Generate Prisma client | `npx prisma generate` |
| Migrate DB | `npx prisma migrate deploy` (or `npm run db:push` locally) |
| Seed app registry | `npm run seed` |
| Dev server | `npm run dev` |
| Background worker (dev) | `npm run worker` |
| Typecheck | `npm run typecheck` |
| Unit/integration tests | `npm test` |
| E2E tests | `npm run test:e2e` |
| Architecture lint | `npm run lint` |
| CI gate | `npm run lint && npm run typecheck && npm test` |

## Development setup

```bash
cp .env.example .env   # fill values; see comments in file
npm install
npx prisma generate
npx prisma migrate deploy   # or: npm run db:push
npm run seed
npm run dev                 # http://localhost:3000
```

Dev auth uses `app/server/devSession.ts` and `/dev-login` (inert in production). Use the dev role switcher to exercise ADMIN / SUPPORT / VIEWER paths.

Required services: control-plane Postgres, Redis. SaleSwitch replica is stubbed via `app/server/connectors/fixtureSource.ts` until a real read-replica DSN is provisioned.

## Patterns for new work

### New tRPC endpoint

1. Add procedure to the appropriate router under `app/server/trpc/routers/`.
2. Wrap with `requireAbility(...)` matching `app/server/rbac.ts`.
3. For merchant reads, resolve data via `getConnector(ctx.appKey)` — never query replica tables directly from services.
4. For mutating operations, use a Prisma transaction that includes `auditService.log(...)` when applicable.
5. Register router in `app/server/trpc/root.ts` if new.

### New UI page

1. Create route file in `app/routes/`.
2. Add to `app/routes.ts` under the `_shell` layout (unless it is a resource/webhook/API route).
3. Call tRPC from the client via `app/lib/trpc.ts` hooks.
4. Mirror RBAC in the UI for UX only — server must still enforce.

### New background job

1. Processor in `app/server/workers/`.
2. Schedule from `server/start.js` or the dev worker entry (`app/server/workers/devWorker.ts`).
3. Prefer writing rollup/snapshot rows over querying live replica data at read time.

### Onboarding a second Shopify app

1. Implement `AppConnector` in `app/server/connectors/<app>Connector.ts`.
2. Register builder via `registerConnectorBuilder` in `registry.ts`.
3. Insert `App` row (replica ref, status ACTIVE) — seed or migration.
4. Add test coverage similar to `test/stub-connector.test.ts`.

## Stub boundaries (MVP)

External deps are stubbed at injectable seams; swapping stubs is a one-file change:

| Dependency | Seam | MVP stub |
|------------|------|----------|
| WorkOS AuthKit | `app/server/auth.ts` | Header/cookie dev identity |
| Read replica | `saleswitchConnector.ts` `ReplicaReadSource` | `fixtureSource.ts` |
| Secrets manager | `app/lib/secrets.ts` | Env-backed |
| Shopify billing | `billingService.ts` | `StubShopifySubscriptionReader` |
| SaleSwitch admin API | `merchantActionService.ts` | Hidden until `SALESWITCH_ADMIN_API_URL` set |

Do not remove these seams or inline env reads when wiring real clients.

## Testing expectations

- Add or extend Vitest tests in `test/` for invariants (RBAC matrix, audit behavior, connector routing, service logic).
- Run `npm run lint && npm run typecheck && npm test` before considering work complete.
- E2E coverage lives in `e2e/`; run locally only when changing user flows.

Key test files: `test/rbac.test.ts`, `test/replica-routing.test.ts`, `test/stub-connector.test.ts`, `test/config.test.ts`.

## Conventions

- **TypeScript ESM** — use `.js` extensions in server-side relative imports.
- **Minimal diffs** — match existing naming, service/router split, and comment style (invariant references like `cp-*` spec IDs are intentional).
- **No secrets in repo** — never commit `.env` or live credentials.
- **Comments** — explain non-obvious business rules and invariants; avoid narrating obvious code.
- **Config changes** — new env vars go in `app/lib/config.ts` (zod schema) and `.env.example`.

## Related docs

- `README.md` — human-oriented overview and verify steps
- `admin-control-plane-2026/mvp-prd.md` — original MVP PRD
- `docs/` — webhooks, SLO, feature flags, self-serve billing, churn retention
- `openspec/changes/` — tiered specs (support desk, ops, growth)
