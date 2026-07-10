## 1. Schema & migration (CP-owned models)

- [x] 1.1 Add `WebhookEvent` model + `WebhookStatus` enum (`RECEIVED PROCESSED FAILED`) to `prisma/schema.prisma`, keyed by a unique `shopifyWebhookId`, with `@@index([appKey, topic, receivedAt])` and `@@index([status])`
- [x] 1.2 Add `ComplianceRequest` model + `ComplianceTopic` (`CUSTOMERS_DATA_REQUEST CUSTOMERS_REDACT SHOP_REDACT`) and `ComplianceStatus` (`RECEIVED IN_PROGRESS COMPLETED FAILED`) enums, with `dueAt`, `dispatchedAt`, `completedAt`, `externalRef`, `webhookEventId`, and `@@index([status, dueAt])` + `@@index([shop])`
- [x] 1.3 Add `BillingAlert` model (CP-owned: shop, appKey, kind/cap-approaching, payload, createdAt, resolvedAt) for cap-approaching events
- [x] 1.4 Run the migration (`mcp__plugin_prisma_Prisma-Local__migrate-dev`) and regenerate the Prisma client; confirm `scripts/check-no-app-db-writes.mjs` stays green

## 2. Webhook ingestion spine (cp-webhook-ingestion)

- [x] 2.1 Add an HMAC util: base64 HMAC-SHA256 of the raw body, constant-time compare against `X-Shopify-Hmac-Sha256`; unit-tested for valid / tampered-body / wrong-secret
- [x] 2.2 Add per-app secret resolution: reuse `SHOPIFY_API_SECRET` for the single tenant; add an `appSecretFor(shop)` path (registry `webhookSecretRef` + `SecretsManager.resolveWebhookSecret`) for multi-app, keeping all `process.env` access in `app/lib/config.ts`
- [x] 2.3 Create `app/routes/webhooks.shopify.tsx` (`action`-only) + register `route("webhooks/shopify", ...)` in `app/routes.ts`; read raw body before parsing, verify HMAC, `401` + `WebhookEvent{hmacValid:false}` on failure
- [x] 2.4 Add a `WebhookService.ingest()`: idempotent `create` guarded by unique `shopifyWebhookId` (duplicate → no re-enqueue), then enqueue a `webhook-process` job, return `200` fast
- [x] 2.5 Create `app/server/workers/webhookProcess.ts` modeled on `kpiRollup.ts` (`connection()`, attempts, exponential backoff, `captureError` on `failed`); switch on `topic` to compliance/billing handlers; mark `WebhookEvent` `PROCESSED`/`FAILED`
- [x] 2.6 Start the webhook worker in `server/start.js` beside `startKpiWorker()`; add an `npm run worker` (`tsx`) entry / dev bootstrap note so jobs process under `react-router dev`
- [x] 2.7 Add a Shopify topic constants module (compliance + billing topic strings in one place)

## 3. GDPR / DSR handling (cp-compliance-dsr)

- [x] 3.1 Implement the compliance branch of the worker: parse payload, upsert a `ComplianceRequest` with `dueAt = receivedAt + 30d`, mark the `WebhookEvent` `PROCESSED`
- [x] 3.2 Add `ComplianceService` (`record`, `markDispatched`, `markCompleted`, `listPending`, `listBreaching`); every transition writes an `AuditLog` row via `AuditService.append(input, tx)` in the same `$transaction`
- [x] 3.3 Add A-phased auto-dispatch: when the app admin API is configured, dispatch export/redaction via the `dispatchAppBacked` pattern, set `IN_PROGRESS` + `dispatchedAt`, audit `compliance.dispatched`; otherwise leave operator-actionable
- [x] 3.4 Add `compliance:manage` ability (ADMIN-only) to the CASL `Action` union + grants in `app/server/rbac.ts`
- [x] 3.5 Add `app/server/trpc/routers/compliance.ts` (`pending`, `breaching` queries; `markCompleted` mutation with type-to-confirm + same-tx audit) and register it in `app/server/trpc/root.ts`
- [x] 3.6 Add `app/routes/compliance.tsx` under `_shell` (TanStack Table queue, countdown-to-`dueAt` column, status chips, "mark fulfilled"); add the ADMIN-visible nav link in `app/routes/_shell.tsx`
- [x] 3.7 Add a repeatable BullMQ "SLA sweep" job (reuse the `scheduleKpiRollup` repeat pattern) that flags near-due/overdue open requests; schedule it in `server/start.js`

## 4. Billing & subscription monitoring (cp-billing-monitoring)

- [x] 4.1 Replace `StubShopifySubscriptionReader` with a connector-backed reader (`AppConnector.getSubscription()`); wire `getBillingService()` to it, leaving the TTL cache + stale-while-error path unchanged
- [x] 4.2 Implement the billing branch of the worker: on `app_subscriptions/update`, append `mrr`/`active_merchants` deltas to `KpiSnapshot` (append-only `kpiService` pattern) and audit `billing.subscription.updated`
- [x] 4.3 On `app_subscriptions/approaching_capped_amount`, raise one `BillingAlert` and audit `billing.cap.approaching`
- [x] 4.4 Document the caveat in code: `app_subscriptions/update` is event-driven, not a renewal heartbeat — periodic KPI rollup stays the MRR source of truth

## 5. Protected-Customer-Data governance (cp-pii-governance)

- [x] 5.1 Add `pii:view` ability to the CASL `Action` union + grants (SUPPORT+ with required reason) in `app/server/rbac.ts`
- [x] 5.2 Mask `email`/PII by default in the merchant read path (`MerchantRow` / `MerchantDetail`) at a single server-side choke point so unauthorized callers never receive the raw value
- [x] 5.3 Add a gated `revealPii` mutation that returns the unmasked value AND writes exactly one `merchant.pii.view` audit row in the same call, capturing a required typed reason in the audit `after`; reject without `pii:view` (`FORBIDDEN`) and without a reason
- [x] 5.4 Add a documented PCD policy checklist (encrypted backups, test/prod separation, incident-response) citing the append-only audit + replica-only reads as evidence

## 6. Tests & verification

- [x] 6.1 HMAC unit tests: valid passes; tampered body / wrong secret → `401`, no enqueue
- [x] 6.2 Idempotency test: duplicate `X-Shopify-Webhook-Id` ingests once, enqueues once
- [x] 6.3 Same-tx audit test: forcing the audit insert to throw rolls back the compliance state change
- [x] 6.4 SLA tests: `dueAt == receivedAt + 30d`; `listBreaching` returns only requests within the breach threshold / overdue
- [x] 6.5 RBAC tests: non-ADMIN → `FORBIDDEN` on `compliance:manage`; reveal without `pii:view` → `FORBIDDEN`; reveal with it writes exactly one `merchant.pii.view` row; unauthorized response omits the raw PII value
- [x] 6.6 Billing tests: `approaching_capped_amount` raises one alert; `update` appends a KPI snapshot and preserves prior rows; reader issues no statement against the primary
- [x] 6.7 E2E (Playwright, mirroring the existing suite): compliance queue renders with a countdown for a seeded near-due request; dev-login role gating hides it from VIEWER
- [x] 6.8 Run typecheck + unit tests + the lint guard (`check-no-app-db-writes.mjs`) green before declaring done

## 7. Shopify configuration & dependencies (out-of-repo)

- [ ] 7.1 Register the three compliance topics (`customers/data_request`, `customers/redact`, `shop/redact`) and two billing topics (`app_subscriptions/update`, `app_subscriptions/approaching_capped_amount`) pointing at the CP webhook URL
- [ ] 7.2 Re-verify topic header names + the Level-1/2 PCD control list + billing-webhook semantics on shopify.dev before coding
- [x] 7.3 Track the SaleSwitch admin API (`SALESWITCH_ADMIN_API_URL`) dependency for full auto-dispatch; confirm the per-app `webhookSecretRef` storage for the multi-app path
