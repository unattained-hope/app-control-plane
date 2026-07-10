## 1. Schema & migration (CP-owned, additive)

- [x] 1.1 Add enums to `prisma/schema.prisma`: `HealthBand` (`HEALTHY AT_RISK CRITICAL`), `LifecycleKind` (`INSTALL UNINSTALL REINSTALL`), `AnnouncementAudience` (`ALL PLAN SHOP_LIST`), `PlanChangeStatus` (`REQUESTED DISPATCHED COMPLETED FAILED`)
- [x] 1.2 Add CP-owned `MerchantHealthSnapshot` (`appKey`, `shop`, `score Float`, `band HealthBand`, `factors Json`, `asOf`, `createdAt`; `@@index([appKey, shop, asOf])`)
- [x] 1.3 Add CP-owned `MerchantLifecycleEvent` (`appKey`, `shop`, `kind LifecycleKind`, `reason String?`, `occurredAt`, `createdAt`; `@@index([appKey, shop, occurredAt])`, `@@index([appKey, kind, occurredAt])`)
- [x] 1.4 Add CP-owned `FeatureFlag` (`appKey`, `key`, `description String?`, `defaultEnabled Boolean @default(false)`, `rolloutPercentage Int?`, timestamps; `@@unique([appKey, key])`) and `FeatureFlagOverride` (`appKey`, `flagKey`, `shop`, `enabled Boolean`, timestamps; `@@unique([appKey, flagKey, shop])`, `@@index([appKey, shop])`)
- [x] 1.5 Add CP-owned `Announcement` (`appKey`, `title`, `body`, `audience AnnouncementAudience`, `audienceValue String?`, `createdBy`, `publishedAt DateTime?`, `expiresAt DateTime?`, timestamps; `@@index([appKey, publishedAt])`) and `NpsResponse` (`appKey`, `shop`, `conversationId String?`, `score Int`, `comment String?`, `createdAt`; `@@index([appKey, shop, createdAt])`)
- [x] 1.6 Add CP-owned `PlanChangeRequest` (`appKey`, `shop`, `fromPlan String?`, `toPlan`, `status PlanChangeStatus @default(REQUESTED)`, `confirmationUrl String?`, `externalRef String?`, `conversationId String?`, timestamps; `@@index([appKey, shop, createdAt])`, `@@index([status])`)
- [x] 1.7 Run `prisma generate` (apply via `db push`/`migrate-dev` against the local DB) and confirm `scripts/check-no-app-db-writes.mjs` stays green (all new models are control-plane-owned; merchant data stays replica-only-read)

## 2. Audit taxonomy, RBAC & config

- [x] 2.1 Extend `app/lib/auditActions.ts` (`KnownAuditAction`) with `merchant.health.evaluated`, `merchant.uninstalled`, `merchant.reinstalled`, `feature.flag.create|update|delete`, `feature.flag.override.set|clear`, `announcement.publish`, `announcement.expire`, `nps.recorded`, and `billing.plan.change.requested|dispatched|completed|failed`
- [x] 2.2 Add `flags:manage` (ADMIN) and `announcements:manage` (ADMIN) to the CASL `Action` union + grants in `app/server/rbac.ts`; update the RBAC matrix doc-comment
- [x] 2.3 Add config to `app/lib/config.ts` (zod, no `process.env` outside it): `GROWTH_ROLLUP_CRON`, the `HEALTH_*` signal weights + `AT_RISK`/`CRITICAL` cutoffs, `NPS_SURVEY_WINDOW_DAYS`, `FEATURE_FLAGS_READ_TOKEN`, `CHURN_RETENTION_PURGE_ENABLED` (default false), and a plan-change admin-API path/flag if not derivable from `SALESWITCH_ADMIN_API_URL`
- [x] 2.4 Add the new audit actions to the filter set in `app/routes/audit.tsx` (auto-derived: `KNOWN_ACTIONS = Object.values(AuditActions)` already surfaces every new constant — no edit needed)

## 3. Uninstall / churn flow (cp-uninstall-churn)

- [x] 3.1 Add `app/uninstalled` to a new `LIFECYCLE_TOPICS` set in `app/lib/shopifyWebhook.ts` and extend `topicCategory` to return `"lifecycle"`
- [x] 3.2 Route the `lifecycle` branch in `app/server/services/webhookProcessor.ts` to a new `lifecycleService.handleWebhook(event)`
- [x] 3.3 Add `lifecycleService`: record a `MerchantLifecycleEvent` (`UNINSTALL`) + audit `merchant.uninstalled` in the same transaction (mirroring `billingMonitor.onCapApproaching`); idempotent via the existing webhook dedupe so a replayed delivery yields one event
- [x] 3.4 Recompute churn KPIs on uninstall (re-run `KpiService.runRollup` so uninstalls 7/30d reflect the change); record a `REINSTALL` event when a previously-uninstalled shop reappears active in the rollup
- [x] 3.5 Implement the documented retention reconciliation: on `shop/redact` completion for an uninstalled shop, purge CP-owned PII-bearing records for that shop (guarded by `CHURN_RETENTION_PURGE_ENABLED`) while never deleting `AuditLog`; author `docs/churn-retention.md` (the redaction stays the compliance flow's job; flag for team/legal confirmation)

## 4. Merchant health scoring (cp-merchant-health)

- [x] 4.1 Add a pure `app/lib/healthScore.ts`: `score({subscription, billingAlerts, usageRecency, openConversations, latestCsat, lifecycle})` → `{ score, band, factors }` via a weighted sum from the `HEALTH_*` config
- [x] 4.2 Add `merchantHealthService.evaluate(appKey, shop)` gathering signals via the connector (replica) + CP tables (conversations, billing alerts, lifecycle) — no app primary, no raw SQL — and calling the scorer
- [x] 4.3 Add a `health` tRPC router (`requireAbility("view")`): `forShop(shop)` (latest snapshot) and `atRisk()` (ranked list, server-paginated, enumerating apps via `appRegistryService`); register in `trpc/root.ts`
- [x] 4.4 Surface the health band + factor breakdown + `asOf` on the merchant-360 panel (`app/routes/merchant-detail.tsx`)
- [x] 4.5 Add `app/routes/at-risk.tsx` (ranked CRITICAL→AT_RISK→HEALTHY with score/factors/`asOf`); register the route in `app/routes.ts`

## 5. Feature flags (cp-feature-flags)

- [x] 5.1 Add a pure `app/lib/featureFlagEval.ts`: `isEnabled(flag, override?, shop)` = override → deterministic `sha256(appKey:key:shop) % 100 < rolloutPercentage` bucket → default
- [x] 5.2 Add `featureFlagService`: CRUD (`flags:manage`, audited `feature.flag.*`), `setOverride`/`clearOverride` (audited `feature.flag.override.*`), and `evaluateForShop(appKey, shop)`
- [x] 5.3 Add a `flags` tRPC router (`flags:manage` for mutations) for the admin UI; register in `trpc/root.ts`
- [x] 5.4 Add the narrow authenticated read endpoint `app/routes/api.flags.tsx` (token-guarded via `FEATURE_FLAGS_READ_TOKEN`; returns the evaluated flag map for a shop; writes nothing to the app DB); register the route in `app/routes.ts`
- [x] 5.5 Add `app/routes/feature-flags.tsx` (ADMIN management UI: list/create/edit flags, set rollout %, set/clear per-shop overrides)

## 6. Announcements + NPS (cp-announcements-nps)

- [x] 6.1 Add `announcementService`: `publish(actor, {title, body, audience, audienceValue, expiresAt?})` (`announcements:manage`, audited `announcement.publish`), resolving the audience to connected shops and persisting a `SYSTEM` `Message` per targeted conversation; honor `expiresAt` (skip expired on new connections)
- [x] 6.2 Broadcast over the chat gateway: emit a Socket.IO `announcement` event (Redis-fanned) from `app/server/realtime/chatGateway.ts`
- [x] 6.3 Add `npsService.record(appKey, shop, conversationId?, score, comment?)` → `NpsResponse`, idempotent within `NPS_SURVEY_WINDOW_DAYS`, audited `nps.recorded`; add a `merchant:nps` socket handler beside `merchant:csat` (acknowledged like `csat:ack`)
- [x] 6.4 Aggregate `NpsResponse` into a `KpiSnapshot` `nps` metric in the growth rollup (promoters−detractors) — implemented in `growthMetricsService.runRollup` (8.1)
- [x] 6.5 Add an `announcements` tRPC router (publish/list + `nps` aggregate read) and `app/routes/announcements.tsx` (ADMIN publish + history); register both

## 7. Self-serve billing portal (cp-self-serve-billing)

- [x] 7.1 Add `planChangeService`: `requestChange(shop, toPlan)` records a `PlanChangeRequest` and, when `isAppAdminApiConfigured()`, dispatches to the SaleSwitch admin API (the `complianceService.autoDispatch` pattern) — audit `billing.plan.change.requested|dispatched|completed|failed` in-tx; the control plane performs no direct billing mutation
- [x] 7.2 Implement the graceful fallback: when the app admin API is absent, open a support `Conversation` capturing the requested plan (no direct mutation)
- [x] 7.3 Add the merchant-facing surface (shop-token authenticated, like the widget — not CASL): read current + available plans via `billingService.getSubscription(shop)` (stale-while-error) and submit a plan-change request; return the managed-pricing confirmation URL
- [x] 7.4 Add an admin `app/routes/plan-requests.tsx` view (`requireAbility("view")`) listing `PlanChangeRequest`s with status; add a `plans` tRPC router if needed; register routes/routers

## 8. Growth rollup worker & startup

- [x] 8.1 Add `app/server/workers/growthRollup.ts` (cloned from `complianceSweep.ts`: `connection()`, `makeGrowthRollupQueue`, `scheduleGrowthRollup(appKey, GROWTH_ROLLUP_CRON)`, `startGrowthRollupWorker` with `withTrace` + `worker.on("failed", … captureError)`) that refreshes `MerchantHealthSnapshot`, recomputes churn aggregates, and aggregates the `nps` `KpiSnapshot`
- [x] 8.2 Start + schedule the growth rollup in `server/start.js` beside the KPI/compliance/SLA/ops sweeps (`startGrowthRollupWorker()` + `scheduleGrowthRollup("saleswitch")`); add it to `app/server/workers/devWorker.ts`

## 9. Tests & verification

- [x] 9.1 Extend `test/helpers/fakeDb.ts` with the seven new models (findFirst/findMany/count/create/update, `gt`/`lt`/`in` operators) preserving `$transaction` rollback + `failAudit`
- [x] 9.2 Health tests: `healthScore` bands at the configured cutoffs; `evaluate` reads via the connector + CP tables (no app-DB read); snapshot is read latest-per-shop; at-risk list orders CRITICAL→AT_RISK→HEALTHY
- [x] 9.3 Uninstall/churn tests: `app/uninstalled` records one `MerchantLifecycleEvent` + `merchant.uninstalled` audit in-tx (rolled back on `failAudit`); duplicate delivery deduped (no double-count); churn KPI recomputed; reinstall recorded; the purge step respects `CHURN_RETENTION_PURGE_ENABLED` and never deletes `AuditLog`
- [x] 9.4 Feature-flag tests: override precedence over percentage; deterministic stable bucketing; `flags:manage` required for mutations (VIEWER/SUPPORT `FORBIDDEN`); the read endpoint rejects a missing/wrong token and writes nothing to the app DB; `feature.flag.*` audited
- [x] 9.5 Announcements/NPS tests: publish requires `announcements:manage`, broadcasts + persists a `SYSTEM` message, audits `announcement.publish`; expired announcement not delivered; `merchant:nps` records one `NpsResponse` per window (idempotent), audits `nps.recorded`; `nps` rolled into `KpiSnapshot`
- [x] 9.6 Self-serve billing tests: with the admin API, a request records a `PlanChangeRequest` + dispatches + audits, no direct mutation; without it, falls back to a support conversation; live-read failure degrades stale/unavailable (never throws)
- [x] 9.7 RBAC tests extended in `test/rbac.test.ts`: `flags:manage` + `announcements:manage` are ADMIN-only; health reads allowed for `view`; merchant-facing surfaces are not gated by CASL
- [x] 9.8 E2E (Playwright, mirroring the existing suite): at-risk list renders for `view`; feature-flags admin UI creates a flag + override (ADMIN) and denies VIEWER; announcement publish (ADMIN); plan-requests view renders
- [x] 9.9 Run typecheck + unit tests + the lint guard (`check-no-app-db-writes.mjs`) green before declaring done

## 10. Dependencies & open questions

- [x] 10.1 Confirm the open questions in `design.md` are resolved or shipped with documented, config-tunable defaults: health weights/cutoffs (`config.ts` `HEALTH_*`), retention purge policy (`docs/churn-retention.md`, `CHURN_RETENTION_PURGE_ENABLED` gated off by default), reinstall detection (inferred), flag read-endpoint auth (`docs/feature-flags.md` + `FEATURE_FLAGS_READ_TOKEN`), the plan-change admin-API contract (`docs/self-serve-billing.md`, PRD D2 / §14.5), NPS cadence/audience (`NPS_SURVEY_WINDOW_DAYS`), and `GROWTH_ROLLUP_CRON`
- [x] 10.2 Confirm §3.4 (announcements/NPS) and §3.5 (self-serve billing) merchant-facing surfaces work within the embedded widget's shop-token + CORS model (reuse `verifyShopToken`/`isAllowedOrigin`); document where the SaleSwitch admin-API plan-change endpoint is owned/built (`docs/self-serve-billing.md` — app team owns it, ticket fallback ships value without it)
