# Apoaap Control Plane (MVP)

Internal multi-app admin for the Apoaap Shopify-app portfolio. Operational for one
tenant (**SaleSwitch**) with a multi-app connector seam so app #2 is a config change.

> Implements the OpenSpec change **`admin-control-plane-mvp`** (proposal/design/specs/tasks
> live in the `badgey` repo under `openspec/changes/admin-control-plane-mvp/`).
> This is a **standalone application** — it does not import or modify Badgy/SaleSwitch.

## Stack

React Router 7 (framework mode, **persistent** Node server) · tRPC v11 · Prisma 6 +
its **own** PostgreSQL · CASL RBAC · cookie role login · Socket.IO + Redis · BullMQ ·
shadcn-style UI + Tremor + TanStack Table/Query · Sentry · zero-trust front.

## Architecture invariants (enforced)

- **Replica-only reads.** All SaleSwitch data is read via an `AppConnector` against a
  read-replica with a **read-only role**. No raw SQL in connectors (it defaults to the
  primary) — guarded by `npm run lint`. Proven by `test/replica-routing.test.ts`.
- **Same-transaction audit.** Every merchant action / role change writes its `AuditLog`
  row in the same Prisma transaction as its effect; the audit log is **append-only**
  (no update/delete path in code).
- **Server-side RBAC.** Roles enforced in tRPC middleware via CASL — UI gating is
  cosmetic. `VIEWER` write → `FORBIDDEN`; audit view + role mgmt are ADMIN-only.
- **Multi-app seam.** Onboarding app #2 = one connector module + one registry row, no
  core edits. Proven by `test/stub-connector.test.ts`.
- **Dashboard from rollups.** The KPI dashboard reads pre-aggregated `KpiSnapshot` rows
  refreshed by a BullMQ job — never live joins on production data.
- **`process.env` only in `app/lib/config.ts`** (zod-validated, fail-fast). Guarded by lint.

## What is stubbed in this MVP build (and why)

The external dependencies (PRD §10) can't be provisioned from a dev box, so the
**seams are real and the logic is complete**, with injectable stubs at the boundary:

| Dependency | Seam | Stub |
|---|---|---|
| Admin identity | `app/server/devSession.ts` + `/dev-login` | Cookie role session (`cp_dev_role`); header seam in `auth.ts` for tests |
| Read-replica (D1) | `app/server/connectors/saleswitchConnector.ts` `ReplicaReadSource` | `fixtureSource.ts` (`isReplicaOnly: true`) |
| Secrets manager | `app/lib/secrets.ts` `SecretsManager` | env-backed, resolves the canonical replica ref |
| Shopify billing (D4) | `app/server/services/billingService.ts` `ShopifySubscriptionReader` | `StubShopifySubscriptionReader` |
| SaleSwitch admin API (D2) | `app/server/services/merchantActionService.ts` | app-backed actions hidden until `SALESWITCH_ADMIN_API_URL` set |
| Sentry / zero-trust | `app/lib/observability.ts` / deploy | no-op without DSN / Cloudflare Access in front |

Swapping each stub for the real client is a one-file change with no caller edits.

## Develop

```bash
cp .env.example .env          # fill from the secrets manager
npm install
npx prisma generate
npx prisma migrate deploy      # or: npx prisma db push  (control-plane DB)
npm run seed                   # seeds the SaleSwitch App registry row
npm run dev
```

## Verify (CI gate — `npm run lint && npm run typecheck && npm test`)

- `npm run lint` — architecture guard (process.env scope, no raw SQL in connectors)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest invariant suite (RBAC matrix, replica-only, search, token,
  cache, KPIs, stub-connector onboarding)

## OCI production deployment

The production admin app runs on the OCI VM, not on the SaleSwitch GCP VM. The
current run-book installation uses this layout:

```text
/opt/app-control-plane/
├── .env                 # production secrets; mode 600
├── compose.yaml         # live app-control-plane Compose project
└── repo/                # this Git checkout
```

The versioned deployer detects that layout and updates it in place, preserving
the existing PostgreSQL, Redis, Caddy, and badge-graphics volumes:

```bash
cd /opt/app-control-plane/repo
git pull --ff-only
bash deploy/oci-production/deploy.sh
```

It pulls the configured upstream, validates the environment, starts dependencies,
creates and verifies a pre-schema database backup, builds the checked-out commit,
synchronizes and seeds the schema, recreates the app, and verifies readiness,
authenticated SSR, Socket.IO, and public HTTPS. See
[`deploy/oci-production/README.md`](deploy/oci-production/README.md) for first-time
setup, the alternative fresh-install layout, Caddy routing, and safety details.

## Open questions carried from design.md

1. `@prisma/extension-read-replicas` ↔ Prisma 6 vs 7 — verify in M0.
2. shadcn/ui vs Mantine — half-day grid spike.
3. Socket.IO vs Ably — after the embedded cross-origin handshake spike.
4. Hosting (Fly/Hetzner/ECS) — co-locate with the replica.
5. First SaleSwitch admin-API endpoint (E4.2) — owner + scope.
