## Why

Badgy/SaleSwitch ships through the Shopify App Store, which imposes hard,
review-gating requirements directly on a tool like this control plane. Today the
control plane has **no Shopify webhook ingestion**, **stubbed billing**
(`StubShopifySubscriptionReader`), and **no PII-access governance** — so it cannot
satisfy the three Tier 0 mandates that block (or impose controls on) App Store
approval: mandatory GDPR/data-subject-request webhooks, Protected-Customer-Data
(PCD) Level-2 controls, and subscription/billing monitoring. These are the floor;
nothing else on the roadmap matters until the portfolio is App-Store-compliant.

This change builds all three on seams the control plane already owns
(BullMQ, same-transaction append-only `AuditLog`, CASL RBAC, the read-only replica
connector, the `process.env`-only-in-`config.ts` invariant) without ever letting the
control plane write the app DB directly.

## What Changes

- **New Shopify webhook ingestion spine** — a React Router resource route
  (`webhooks/shopify`, dev/prod parity with the existing `trpc/*` route) that reads
  the raw body, verifies the HMAC-SHA256 signature in constant time, persists an
  idempotent `WebhookEvent` (deduped by `X-Shopify-Webhook-Id`), enqueues a BullMQ
  job, and returns `200` fast. A new `webhook-process` queue + worker fans out by
  topic to the compliance and billing handlers.
- **GDPR / Data-Subject-Request handling (§0.1)** — ingest + HMAC-verify the three
  mandatory compliance webhooks (`customers/data_request`, `customers/redact`,
  `shop/redact`), persist a `ComplianceRequest` with a **30-day SLA `dueAt`**, audit
  every state transition in the same transaction, and surface an ADMIN-gated queue
  page with a countdown-to-due column and a type-to-confirm "mark fulfilled" action.
  A repeatable BullMQ sweep flags breaching requests. Auto-dispatch to the app admin
  API is wired but **A-phased**: operator marks fulfilment manually until
  `SALESWITCH_ADMIN_API_URL` exists.
- **Protected-Customer-Data governance (§0.2)** — a new `pii:view` ability; merchant
  email/PII **masked by default** in the directory and detail views; a gated,
  audited `revealPii` mutation (`merchant.pii.view`) that records a typed reason;
  plus a documented policy checklist (encrypted backups, test/prod separation,
  incident-response) covering the non-code Level-2 controls.
- **Billing & subscription monitoring (§0.3)** — subscribe to
  `app_subscriptions/update` and `app_subscriptions/approaching_capped_amount`;
  on update, append `mrr`/`active_merchants` deltas to `KpiSnapshot`; on
  cap-approaching, raise a `BillingAlert`. **Un-stub** `billingService` by backing
  the reader with the connector's replica read (`AppConnector.getSubscription()`),
  keeping reads replica-only and the existing TTL/stale-while-error cache intact.
- **Schema** — add CP-owned models `WebhookEvent`, `ComplianceRequest`,
  `BillingAlert` and their enums in one Prisma migration. All are control-plane-owned
  (invariant-safe); the lint guard `check-no-app-db-writes.mjs` stays green.

## Capabilities

### New Capabilities
- `cp-webhook-ingestion`: HMAC-verified, idempotent Shopify webhook ingestion spine
  — resource route, raw-body signature verification, `WebhookEvent` dedupe, BullMQ
  `webhook-process` queue/worker fan-out, and per-app webhook-secret resolution.
- `cp-compliance-dsr`: GDPR/data-subject-request handling — the three mandatory
  compliance webhooks, `ComplianceRequest` with a 30-day SLA timer, same-transaction
  audit of every fulfilment step, an ADMIN-gated queue UI, and an SLA-breach sweep.
- `cp-pii-governance`: Protected-Customer-Data Level-2 controls — `pii:view` ability,
  default PII masking in merchant reads, an audited `revealPii` reveal with a typed
  reason, and the documented backup/separation/incident-response policy.
- `cp-billing-monitoring`: subscription-lifecycle monitoring — `app_subscriptions/*`
  webhooks, KPI deltas into `KpiSnapshot`, cap-approaching `BillingAlert`, and the
  real (replica-backed) subscription reader replacing the stub.

### Modified Capabilities
<!-- No OpenSpec spec files exist yet under openspec/specs/; the billing behavior change
     is captured as part of the new cp-billing-monitoring capability rather than a delta. -->

## Impact

- **New code**: `app/routes/webhooks.shopify.tsx`; `app/server/workers/webhookProcess.ts`;
  services `complianceService.ts`, `billingAlertService.ts`, a `WebhookService`; tRPC
  router `compliance.ts` (+ registration in `trpc/root.ts`); routes
  `app/routes/compliance.tsx` (+ nav link in `_shell.tsx`); HMAC util + per-app secret
  resolution in `lib/secrets.ts`.
- **Modified code**: `prisma/schema.prisma` (3 models, 4 enums, 1 migration);
  `app/server/rbac.ts` (`compliance:manage`, `pii:view` abilities); `app/lib/config.ts`
  (reuse `SHOPIFY_API_SECRET`; optional per-app `webhookSecretRef`); `billingService.ts`
  (connector-backed reader); merchant read path masking; `server/start.js` (start the
  webhook worker + schedule the SLA sweep, beside `startKpiWorker()`); `app/routes.ts`.
- **Dependencies / assumptions**: Shopify app config must register the three compliance
  + two billing topics and point their URLs at the control plane (Option A topology);
  full auto-dispatch needs `SALESWITCH_ADMIN_API_URL` (currently optional/stubbed — ship
  A-phased); re-verify Shopify topic header names + Level-1/2 PCD control lists on
  shopify.dev before coding.
- **Invariants preserved**: replica-only reads; same-transaction append-only audit;
  server-side CASL RBAC; control plane never writes the app DB (app-data mutation only
  via the narrow admin API); `process.env` only in `config.ts`. No core connector edits
  required — topic→app routing keys off the shop→registry lookup, so app #2 stays one
  connector + one registry row.
