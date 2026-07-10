# Tier 0 Implementation Plan — Shopify App-Store-gating features

> Companion to [roadmap.md](roadmap.md). Turns the three **Tier 0 (mandatory)** items into a
> concrete, codebase-grounded build plan: GDPR/DSR handling (§0.1), Protected-Customer-Data
> governance (§0.2), and billing/subscription monitoring (§0.3).
>
> Every step reuses an existing seam and respects the enforced invariants: **replica-only
> reads**, **same-transaction append-only audit**, **server-side CASL RBAC**, **the control
> plane never writes the app DB**, and **`process.env` only in `app/lib/config.ts`**.

---

## The one architectural decision (decide before building)

Shopify delivers compliance and billing webhooks **to the app (Badgy)**, signs them with
**the app's API secret**, and only Badgy can mutate its own data. The control plane is
read-only against Badgy's replica. So "the control plane handles GDPR webhooks" must mean one
of two topologies:

| Option | Ingestion | Execution (redaction/export) | Fit with invariants |
|--------|-----------|------------------------------|---------------------|
| **A — CP as orchestrator (recommended)** | Compliance/billing webhook URLs point at the **control plane**; CP verifies HMAC with the app secret (resolved per-app via the registry/secrets seam) | CP **dispatches** the export/redaction to Badgy via the app-backed admin API (`SALESWITCH_ADMIN_API_URL`), then records fulfilment | ✅ CP writes only its own DB; app-data mutation goes through the narrow app API; same-tx audit |
| **B — Badgy ingests, CP observes** | Badgy receives the webhooks (it must anyway) and writes a request row in its own DB | Badgy executes; CP **reads** pending requests via the replica and shows the SLA dashboard | ✅ Also invariant-safe, but CP can't drive fulfilment — it's a read-only monitor |

**Recommendation: Option A.** It makes the control plane the portfolio's compliance command
center (the whole point of a multi-app control plane) and reuses the existing app-backed
dispatch seam. **Dependency:** auto-execution needs the SaleSwitch admin API
(`SALESWITCH_ADMIN_API_URL`), which is currently optional/stubbed. Until that endpoint exists,
ship **A-phased**: CP ingests + tracks + an operator manually marks fulfilment (does the
redaction in Badgy by hand), then flip on auto-dispatch when the admin API lands. The rest of
this plan assumes Option A.

---

## Shared foundation — Shopify webhook ingestion seam

Both §0.1 and §0.3 ride the same spine. Build this first.

### F1. Webhook resource route (dev/prod parity)
Implement ingestion as a **React Router resource route**, not an Express route, so it runs
under both `react-router dev` and the production `server/start.js` handler (mirrors the
existing `route("trpc/*", ...)` pattern in [app/routes.ts](app/routes.ts)).

- New route: `route("webhooks/shopify", "routes/webhooks.shopify.tsx")` — `action` only, no
  component.
- The `action` receives the Web `Request`; read the **raw body** with `await request.text()`
  **before** parsing (HMAC is computed over raw bytes).
- Headers to read: `X-Shopify-Hmac-Sha256`, `X-Shopify-Topic`, `X-Shopify-Shop-Domain`,
  `X-Shopify-Webhook-Id`, `X-Shopify-API-Version`.
- **Verify HMAC** = base64 HMAC-SHA256 of the raw body using the app secret; constant-time
  compare. Invalid → `401`, log a `WebhookEvent` with `hmacValid:false`, do **not** enqueue.
- **Fast 200 pattern:** on valid HMAC, persist a `WebhookEvent` (idempotency), enqueue a
  BullMQ job, return `200` immediately. All real work happens in the worker. Shopify retries
  on non-2xx, so never block the response on processing.

```ts
// app/routes/webhooks.shopify.tsx (sketch)
export async function action({ request }: ActionFunctionArgs) {
  const raw = await request.text();
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = request.headers.get("x-shopify-shop-domain");
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "";
  if (!verifyShopifyHmac(raw, request.headers.get("x-shopify-hmac-sha256"), appSecretFor(shop))) {
    return new Response("invalid hmac", { status: 401 });
  }
  await getWebhookService().ingest({ webhookId, topic, shop, raw }); // idempotent insert + enqueue
  return new Response(null, { status: 200 });
}
```

### F2. `WebhookEvent` model — idempotency + the webhook-reliability primitive
Control-plane-owned (CP's own DB → invariant-safe). Doubles as the Tier 2.4 "failed
deliveries" log.

```prisma
enum WebhookStatus { RECEIVED PROCESSED FAILED }

model WebhookEvent {
  id              String        @id @default(cuid())
  appKey          String
  topic           String        // "customers/redact", "app_subscriptions/update", ...
  shopifyWebhookId String       @unique   // dedupe: at-least-once delivery
  shop            String?
  hmacValid       Boolean
  status          WebhookStatus @default(RECEIVED)
  payload         Json
  error           String?
  receivedAt      DateTime      @default(now())
  processedAt     DateTime?
  @@index([appKey, topic, receivedAt])
  @@index([status])
  @@map("webhook_events")
}
```
`ingest()` does `create` guarded by the unique `shopifyWebhookId`; on conflict it's a duplicate
delivery → no re-enqueue (idempotent). Then `webhookQueue.add(...)`.

### F3. `webhook-process` BullMQ queue + worker
Clone the structure of [kpiRollup.ts](app/server/workers/kpiRollup.ts) (same `connection()`
helper, `attempts`, exponential backoff, `captureError` on `failed`). The worker switches on
`topic` and routes to the compliance or billing handler. Register it in
[server/start.js](server/start.js) next to `startKpiWorker()`.

> **Dev-worker note:** the worker is only started by the persistent `server/start.js`
> (production). For `react-router dev`, add a small `npm run worker` (`tsx`) entry or start the
> worker in the dev bootstrap, otherwise enqueued jobs sit unprocessed locally. Flag, don't
> block.

### F4. Config + per-app secret resolution
In [app/lib/config.ts](app/lib/config.ts): the app webhook HMAC uses the Shopify **API
secret**, already present as `SHOPIFY_API_SECRET` — reuse it for the single-tenant MVP. For
multi-app, resolve the per-app secret via the secrets seam: add `webhookSecretRef` to the
`App` registry row (mirroring `replicaRef`) and a `resolveWebhookSecret(ref)` method on
[SecretsManager](app/lib/secrets.ts). `appSecretFor(shop)` maps shop→app→secretRef→secret.

---

## §0.1 — GDPR / Data-Subject-Request handling 🔴

### Schema (CP-owned)
```prisma
enum ComplianceTopic  { CUSTOMERS_DATA_REQUEST CUSTOMERS_REDACT SHOP_REDACT }
enum ComplianceStatus { RECEIVED IN_PROGRESS COMPLETED FAILED }

model ComplianceRequest {
  id           String           @id @default(cuid())
  appKey       String
  topic        ComplianceTopic
  shop         String
  status       ComplianceStatus @default(RECEIVED)
  payload      Json             // customer ids / data_request payload from Shopify
  receivedAt   DateTime         @default(now())
  dueAt        DateTime         // receivedAt + 30 days — drives the SLA timer
  dispatchedAt DateTime?        // when CP called the app admin API
  completedAt  DateTime?
  externalRef  String?          // app's job/confirmation id
  webhookEventId String?
  @@index([status, dueAt])      // the "what's breaching" query
  @@index([shop])
  @@map("compliance_requests")
}
```

### Worker handler (`compliance` branch of F3)
1. Parse payload, upsert a `ComplianceRequest` (`dueAt = receivedAt + 30d`).
2. **Option-A auto-dispatch:** if the app admin API is configured, call it (reuse the
   `dispatchAppBacked` pattern in
   [merchantActionService.ts](app/server/services/merchantActionService.ts)) to execute the
   export/redaction; set `status=IN_PROGRESS`, `dispatchedAt`. Audit the dispatch.
3. Mark `WebhookEvent.status=PROCESSED`.

### Service + same-transaction audit
New `ComplianceService` with `record()`, `markDispatched()`, `markCompleted()`, `listPending()`,
`listBreaching()`. Every state change writes an `AuditLog` row **in the same `$transaction`**
via `AuditService.append(input, tx)` (exact pattern already used by `addNote`/`addTag`). Audit
actions: `compliance.request.received`, `compliance.dispatched`, `compliance.completed`,
`compliance.failed`.

### RBAC
Add ability `compliance:manage` → **ADMIN-only** in [rbac.ts](app/server/rbac.ts) (extend the
`Action` union + the ADMIN block). Webhook ingestion itself is unauthenticated (HMAC is the
auth); only the operator UI/mutations are gated.

### tRPC router + page
- `app/server/trpc/routers/compliance.ts`: `pending` / `breaching` queries (gated by
  `compliance:manage`), `markCompleted` mutation (same-tx audit, type-to-confirm like other
  actions). Register in [root.ts](app/server/trpc/root.ts).
- `app/routes/compliance.tsx` under the `_shell` layout: a queue table (TanStack Table) with a
  **countdown-to-`dueAt`** column, status chips, and a "mark fulfilled" action. Add the nav
  link in [_shell.tsx](app/routes/_shell.tsx) (visible to ADMIN).
- A BullMQ **repeatable** "SLA sweep" job (reuse `scheduleKpiRollup` pattern) that flags
  requests within N days of `dueAt` and surfaces/alerts them.

---

## §0.3 — Billing & subscription monitoring 🔴

### Webhook topics (ride F1–F3)
Subscribe Badgy to `app_subscriptions/update` and
`app_subscriptions/approaching_capped_amount`; point them at the CP webhook URL (Option A).
Worker `billing` branch:
- `app_subscriptions/update` → recompute/append the `mrr` + `active_merchants` deltas into
  `KpiSnapshot` (reuse [kpiService.ts](app/server/services/kpiService.ts) append-only pattern);
  audit `billing.subscription.updated`.
- `approaching_capped_amount` → raise a **cap-approaching alert** (a CP-owned `BillingAlert`
  row or a Sentry/notification message); audit `billing.cap.approaching`.
- **Caveat baked into design:** `app_subscriptions/update` does **not** fire on every monthly
  auto-renewal — treat it as event-driven, and keep the periodic KPI rollup as the source of
  truth for MRR, with webhooks as low-latency nudges.

### Un-stub the reader
`StubShopifySubscriptionReader` → a real reader. The CP has no per-shop Shopify token (those
live in Badgy), so **back the reader with the connector's replica read**
(`AppConnector.getSubscription()` already returns `SubscriptionState` from the replica) rather
than a direct Shopify call. Wire `getBillingService()` to construct the connector-backed reader
instead of the stub. This keeps reads replica-only and the existing TTL cache + stale-while-
error behavior in [billingService.ts](app/server/services/billingService.ts) unchanged. (A
direct Shopify Admin API reader remains a later option if live, sub-replica-lag data is needed.)

---

## §0.2 — Protected-Customer-Data governance 🔴

This is mostly governance wiring on the RBAC + audit seams, plus a policy checklist.

| Shopify Level-2 control | Implementation | Seam |
|-------------------------|----------------|------|
| **Limit staff access to PII** | New ability `pii:view`; merchant email/PII fields **masked by default** in the directory/detail, revealed only for roles with `pii:view` | CASL [rbac.ts](app/server/rbac.ts) + connector/merchant service masking |
| **Access log to PII** | A gated `revealPii` mutation that returns the unmasked value **and writes an `AuditLog` row** (`merchant.pii.view`) in the same call — every PII reveal is logged | `AuditService` (append-only) |
| **Encrypt data backups** | Infra/policy: confirm CP Postgres + replica backups are encrypted at rest | ops (document in this repo) |
| **Test/prod separation** | Already partly held by replica-only reads + separate CP DB; document the boundary | ops |
| **Incident-response policy** | Written policy doc + the §0.1 audit trail as evidence | doc |

Code work here is small: extend the `Action` union, add masking in the merchant read path
(`MerchantRow.email` / `MerchantDetail.email`), and add the `revealPii` audited mutation.
Decide whether `pii:view` is SUPPORT+ or ADMIN-only with a required reason (recommend: SUPPORT+
**with** a typed reason captured into the audit `after` field, matching the type-to-confirm
ergonomics already in `merchantActionService`).

---

## Cross-cutting

- **Lint guard:** `scripts/check-no-app-db-writes.mjs` must stay green — all new models
  (`WebhookEvent`, `ComplianceRequest`, `BillingAlert`) are CP-owned; app-data mutation is
  HTTP-only via the admin API. Keep all `process.env` reads in `config.ts`.
- **Migrations:** one Prisma migration adds the three models + four enums; update
  [prisma/schema.prisma](prisma/schema.prisma) and run `db:migrate`.
- **Multi-app seam:** nothing here hard-codes `saleswitch`; topic→app routing keys off the
  shop→registry lookup, so app #2 is still one connector + one registry row (+ its
  `webhookSecretRef`).

## Testing matrix
- HMAC verify: valid passes, tampered body / wrong secret → 401 (unit).
- Idempotency: duplicate `X-Shopify-Webhook-Id` ingests once, enqueues once.
- Same-tx audit: forcing the audit insert to throw rolls back the compliance state change.
- SLA: `dueAt == receivedAt + 30d`; `listBreaching` returns only `< threshold`.
- RBAC: non-ADMIN → `FORBIDDEN` on `compliance:manage`; PII reveal without `pii:view` →
  `FORBIDDEN`; reveal **with** it writes exactly one `merchant.pii.view` audit row.
- Billing: `approaching_capped_amount` raises one alert; `update` appends KPI snapshot.
- E2E (Playwright, mirrors existing suite): compliance queue page renders with a countdown for
  a seeded near-due request; dev-login role gating hides it from VIEWER.

## Sequencing & rough effort
1. **Foundation F1–F4** (webhook route + HMAC + `WebhookEvent` + queue/worker + config) — **M**, unblocks everything.
2. **§0.1 GDPR/DSR** (schema, worker branch, service+audit, router, page, SLA sweep) — **M**.
3. **§0.3 billing** (topics, worker branch, un-stub reader, KPI deltas, cap alert) — **S–M**.
4. **§0.2 PCD** (`pii:view`, masking, audited reveal, policy checklist) — **S**, plus ops/doc items.

Foundation + §0.1 is the critical path to App-Store readiness; §0.3 and §0.2 layer on after.

## Open dependencies / to confirm
- **SaleSwitch admin API** (`SALESWITCH_ADMIN_API_URL`) for auto-dispatch of redaction/export —
  needed for full Option A; ship A-phased (manual fulfilment) until it exists.
- **Shopify app config**: register the three compliance topics + two billing topics and point
  their URLs at the CP (or confirm Option B if you'd rather Badgy ingest).
- **Per-app webhook secret** storage in the registry/secrets manager for multi-app.
- Re-verify topic header names, the Level-1/2 control list, and billing-webhook semantics on
  shopify.dev before coding (Shopify changes these).
