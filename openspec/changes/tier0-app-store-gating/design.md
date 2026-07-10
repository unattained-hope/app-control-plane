## Context

Badgy/SaleSwitch is distributed through the Shopify App Store, which gates approval
on three Tier 0 controls: mandatory GDPR/data-subject-request webhooks, the
Protected-Customer-Data (PCD) Level-2 control set, and subscription/billing handling.
The control plane today has the supporting seams but none of the Tier 0 surface:

- **No Shopify webhook ingestion.** The only resource route is `trpc/*`
  ([app/routes.ts](../../../app/routes.ts)).
- **Billing is stubbed.** `getBillingService()` constructs a
  `StubShopifySubscriptionReader` returning a `none` baseline
  ([billingService.ts](../../../app/server/services/billingService.ts)).
- **No PII governance.** `MerchantRow.email` / `MerchantDetail.email` are returned
  raw; CASL `Action` is `view | reply | action:* | audit:view | roles:manage`
  ([rbac.ts](../../../app/server/rbac.ts)) — no `pii:view`.

The reusable seams that this design rides:

- **Append-only, same-transaction audit:** `AuditService.append(input, tx)` accepts a
  transaction client so the audit row commits atomically with its effect
  ([auditService.ts](../../../app/server/services/auditService.ts)); the
  notes/tags/app-backed actions already use it
  ([merchantActionService.ts](../../../app/server/services/merchantActionService.ts)).
- **BullMQ worker pattern:** `connection()` + `attempts`/exponential backoff +
  `captureError` on `failed`, started from `server/start.js` beside `startKpiWorker()`
  ([kpiRollup.ts](../../../app/server/workers/kpiRollup.ts)).
- **Replica-only connector:** `AppConnector.getSubscription()` already returns
  `SubscriptionState` from the replica ([types.ts](../../../app/server/connectors/types.ts)).
- **Config + secrets invariants:** `process.env` only in
  [config.ts](../../../app/lib/config.ts) (already validates `SHOPIFY_API_SECRET`,
  `SALESWITCH_ADMIN_API_URL`); per-app secret resolution via
  [secrets.ts](../../../app/lib/secrets.ts). Both enforced by
  `scripts/check-no-app-db-writes.mjs`.

## Goals / Non-Goals

**Goals:**

- HMAC-verified, idempotent ingestion of the three compliance + two billing webhooks
  with dev/prod parity.
- A `ComplianceRequest` queue with a 30-day SLA timer and same-transaction audit on
  every transition.
- PCD Level-2 application controls: default PII masking + an audited `revealPii`.
- Un-stub billing with a replica-backed reader; subscription-update KPI deltas and a
  cap-approaching alert.
- Preserve every architecture invariant — replica-only reads, same-tx audit,
  server-side CASL, no app-DB writes, `process.env` only in `config.ts` — and require
  **zero** core connector edits to add app #2.

**Non-Goals:**

- Building the SaleSwitch admin API endpoint itself (a parallel dependency; this
  change is A-phased and works without it).
- A full webhook reliability layer with a dead-letter UI (roadmap §2.4) beyond the
  idempotency + retry primitive `WebhookEvent` already provides.
- Churn/health scoring, self-serve billing portal, or merchant-facing surfaces.
- The non-code PCD controls (encrypted backups, test/prod separation, IR policy) are
  *documented*, not engineered, here.

## Decisions

### D1 — Topology: control plane orchestrates (Option A), A-phased

Webhook URLs point at the **control plane**, which verifies HMAC with the app secret
and (when available) dispatches execution to the app admin API; it records fulfilment
in its own DB. **Alternative (Option B):** Badgy ingests and the CP only reads pending
requests from the replica. Option A is chosen because it makes the CP the portfolio's
compliance command center and reuses the existing `dispatchAppBacked` seam, while
still honoring "CP never mutates the app DB" (mutation goes through the narrow admin
API). Because `SALESWITCH_ADMIN_API_URL` is currently optional/stubbed, ship
**A-phased**: ingest + track + manual operator fulfilment now, flip on auto-dispatch
when the admin API lands — with no change to the audit/SLA contract.

### D2 — Ingestion as a React Router resource route, not Express

Implement `route("webhooks/shopify", "routes/webhooks.shopify.tsx")` (`action` only).
**Alternative:** an Express route in `server/start.js`. Rejected because an Express
route would not run under `react-router dev`, breaking local parity; the existing
`trpc/*` resource route already proves the pattern works under both runtimes. The
`action` reads `await request.text()` **before** parsing because HMAC is over raw
bytes, verifies the signature (base64 HMAC-SHA256, constant-time compare), and on
success persists + enqueues + returns `200` fast. Invalid HMAC → `401` and a
`WebhookEvent{hmacValid:false}` for forensics; never enqueue.

### D3 — `WebhookEvent` as the idempotency + reliability primitive

A CP-owned `WebhookEvent` keyed by a unique `shopifyWebhookId` gives at-least-once
dedupe: `ingest()` does a `create` guarded by the unique constraint; on conflict it's
a duplicate → no re-enqueue. It doubles as the failed-delivery log (roadmap §2.4).
**Fast-200 pattern:** the route never does real work inline — it enqueues a
`webhook-process` BullMQ job and returns `200`, because Shopify retries on any
non-2xx. The worker switches on `topic` to the compliance or billing branch, mirroring
`kpiRollup.ts` structure, and marks `status` `PROCESSED`/`FAILED`.

### D4 — Per-app secret resolution reuses `config` + `secrets` seams

MVP single tenant: verify HMAC against the existing `SHOPIFY_API_SECRET`
([config.ts](../../../app/lib/config.ts)) — no new env required. Multi-app: add a
`webhookSecretRef` column to the `App` registry row (mirroring `replicaRef`) and a
`resolveWebhookSecret(ref)` method on `SecretsManager`
([secrets.ts](../../../app/lib/secrets.ts)); `appSecretFor(shop)` maps
shop → app → ref → secret. `process.env` stays confined to `config.ts`.

### D5 — Compliance: `ComplianceRequest` + 30-day `dueAt` + same-tx audit + sweep

`dueAt = receivedAt + 30 days` drives the SLA; `@@index([status, dueAt])` powers the
"what's breaching" query. A new `ComplianceService` (`record`, `markDispatched`,
`markCompleted`, `listPending`, `listBreaching`) writes an `AuditLog` row in the
**same `$transaction`** on every transition — the exact pattern `addNote`/`addTag`
already use, so an audit-insert failure rolls back the transition (spec atomicity). A
repeatable BullMQ "SLA sweep" (reuse `scheduleKpiRollup`'s repeat pattern) flags
near-due/overdue open requests. The tRPC `compliance` router (`pending`, `breaching`,
`markCompleted`) is gated by a new ADMIN-only `compliance:manage` ability; the
operator page lives under `_shell` with a countdown column and a type-to-confirm
"mark fulfilled". Webhook ingestion itself stays unauthenticated — HMAC is the auth.

### D6 — PII governance: mask in the read path, audited reveal, new ability

Add `pii:view` to the CASL `Action` union and grants. Mask `email`/PII in the
merchant read path (`MerchantRow`/`MerchantDetail`) so an unauthorized caller never
receives the raw value over the wire — masking is server-side, not UI-only. A gated
`revealPii` mutation returns the unmasked value **and** writes one
`merchant.pii.view` audit row in the same call, capturing a **typed reason** into the
audit `after` field (matching the type-to-confirm ergonomics already in
`merchantActionService`). **Decision:** `pii:view` is **SUPPORT+ with a required
reason** (not ADMIN-only) — support agents legitimately need PII to do their job, and
the audited typed-reason reveal gives the access log Shopify's Level-2 control
requires without blocking the daily workflow. The non-code controls (encrypted
backups, test/prod separation, IR policy) ship as a documented checklist citing the
audit log + replica-only reads as evidence.

### D7 — Billing: connector-backed reader, KPI deltas, cap alert

Replace `StubShopifySubscriptionReader` with a reader that calls
`AppConnector.getSubscription()` (replica-only — the CP holds no per-shop Shopify
token), wired in `getBillingService()`. **Alternative:** a direct Shopify Admin API
reader; rejected for MVP because it needs per-shop tokens the CP doesn't hold, though
it remains a later option if sub-replica-lag freshness is needed. The existing TTL
cache + stale-while-error path is untouched. The worker's `billing` branch appends
`mrr`/`active_merchants` deltas to `KpiSnapshot` (append-only `kpiService` pattern) on
`app_subscriptions/update` and raises a CP-owned `BillingAlert` on
`approaching_capped_amount`. **Caveat baked in:** `app_subscriptions/update` does not
fire on every renewal — the periodic KPI rollup stays the MRR source of truth;
webhooks are low-latency nudges.

### D8 — One migration, all CP-owned models

A single Prisma migration adds `WebhookEvent`, `ComplianceRequest`, `BillingAlert`
and enums `WebhookStatus`, `ComplianceTopic`, `ComplianceStatus` (+ any billing-alert
enum). All three are control-plane-owned, so the `check-no-app-db-writes.mjs` guard
stays green; app-data mutation remains HTTP-only via the admin API. Nothing hard-codes
`saleswitch` — topic→app routing keys off shop→registry lookup.

## Risks / Trade-offs

- **No app admin API yet (`SALESWITCH_ADMIN_API_URL` optional)** → Ship A-phased:
  ingest + track + manual fulfilment; auto-dispatch flips on when the endpoint lands,
  with the same audit/SLA contract. Tracked as a parallel dependency.
- **BullMQ worker not started under `react-router dev`** → enqueued jobs would sit
  unprocessed locally. Add an `npm run worker` (`tsx`) entry or start the worker in the
  dev bootstrap; flag in docs. Production is unaffected (`server/start.js` starts it).
- **Shopify changes topic header names / Level-1/2 control lists / billing semantics**
  → Re-verify on shopify.dev before coding; keep topic strings in one constants module
  so a rename is a single edit.
- **`app_subscriptions/update` mistaken for a renewal heartbeat** → It does not fire on
  every auto-renewal. Design keeps the periodic KPI rollup as MRR source of truth;
  webhooks only nudge.
- **PII masking missed on a read path** → Centralize masking in the merchant read/
  serialization layer (one choke point) rather than per-route, and assert the unmasked
  value is absent from unauthorized responses in tests.
- **Replica lag on subscription reads** → Already mitigated by the `stale` flag +
  "as of" surfacing; a direct Shopify reader remains a later option if needed.

## Migration Plan

1. Add the three models + enums to `prisma/schema.prisma`; run `db:migrate`
   (`mcp__plugin_prisma_Prisma-Local__migrate-dev`). New tables only — no destructive
   change, so rollback is dropping the new tables.
2. Land the ingestion spine (route + HMAC util + `WebhookEvent` + `webhook-process`
   queue/worker + config/secret resolution) behind no flag — it's inert until Shopify
   is configured to deliver to it.
3. Land §0.1 compliance (service + router + page + SLA sweep), §0.3 billing (un-stub +
   branch + alert), §0.2 PII (ability + masking + reveal) — each independently
   shippable on the spine.
4. **Shopify-side:** register the three compliance + two billing topics pointing at the
   CP webhook URL. Until then the spine simply receives nothing.
5. Start the webhook worker + schedule the SLA sweep in `server/start.js`.
6. **Rollback:** topics can be unregistered in Shopify; the route/worker are additive
   and can be removed; the migration drops cleanly (new tables only).

## Open Questions

- First SaleSwitch admin-API endpoint for auto-dispatch (E4.2 dependency) — who owns
  building it, and what is its contract?
- Confirm exact Shopify topic header strings and the current Level-1/2 PCD control list
  on shopify.dev at implementation time.
- Final `pii:view` policy: SUPPORT+ with required reason (recommended here) vs
  ADMIN-only — confirm with the team.
- Per-app `webhookSecretRef` storage format in the registry/secrets manager for the
  multi-app path (not needed for the single-tenant MVP).
