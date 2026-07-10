## Context

Tier 0 ([tier0-app-store-gating](../tier0-app-store-gating/proposal.md)) cleared the App-Store
floor (webhook ledger, GDPR/DSR, PCD, billing); Tier 1
([tier1-support-merchant-success](../tier1-support-merchant-success/proposal.md)) turned the inbox
into a real desk (SLA, canned replies, routing, CSAT/tags, merchant-360); Tier 2
([tier2-scale-readiness](../tier2-scale-readiness/proposal.md)) made it operable (monitoring,
webhook reliability, SLO alerting, break-glass). Tier 3 is **growth & retention** — the levers to
see at-risk merchants, handle churn, dark-launch features, talk to merchants, and let them self-
serve billing. It rides seams verified against the codebase:

- **Connector + replica-only reads.** The core depends only on the `AppConnector` interface
  ([types.ts](../../../app/server/connectors/types.ts)) — `listMerchants`, `getMerchant`
  (`MerchantDetail` already carries `lifecycle` + `uninstalledAt`), `getSubscription`,
  `computeKpis` — never a raw app table. Health/usage reads go through it; **no connector-interface
  change** in this tier.
- **Pre-aggregated KPIs.** `KpiSnapshot` ([schema.prisma](../../../prisma/schema.prisma)) is
  appended by a rollup worker and read latest-per-metric by `KpiService.latest`
  ([kpiService.ts](../../../app/server/services/kpiService.ts)); the dashboard renders Tremor cards
  from it, never a live join. Health snapshots + the `nps` metric reuse this exact path.
- **Webhook ledger + topic routing.** Ingestion ([webhooks.shopify.tsx](../../../app/routes/webhooks.shopify.tsx))
  HMAC-verifies ([shopifyWebhook.ts](../../../app/lib/shopifyWebhook.ts) `verifyShopifyHmac`,
  `topicCategory`), persists a `WebhookEvent` (with Tier-2 content-hash + dead-letter), and the
  worker runs `processWebhookEvent` ([webhookProcessor.ts](../../../app/server/services/webhookProcessor.ts))
  which fans out by `topicCategory` to compliance/billing. Today categories are
  `compliance | billing | other`; `app/uninstalled` falls through as `other` (acknowledged, no-op).
- **Compliance 30-day SLA.** `ComplianceRequest` ([complianceService.ts](../../../app/server/services/complianceService.ts))
  records `customers/redact` / `shop/redact` with `dueAt = receivedAt + 30d`, every transition
  audited in-tx, dispatched to the app admin API when configured. This is the redaction authority
  the uninstall flow reconciles **against**, not duplicates.
- **Billing read + app-admin-API dispatch.** `BillingService` ([billingService.ts](../../../app/server/services/billingService.ts))
  reads `getSubscription` via the `ConnectorSubscriptionReader` with a TTL cache + stale-while-error;
  `complianceService.autoDispatch` ([complianceService.ts](../../../app/server/services/complianceService.ts))
  is the canonical pattern for POSTing a mutating action to the narrow SaleSwitch admin API
  (`SALESWITCH_ADMIN_API_URL` + token, gated by `isAppAdminApiConfigured()` in
  [config.ts](../../../app/lib/config.ts)). The self-serve plan change reuses both.
- **Chat gateway + CSAT pattern.** `attachChatGateway` ([chatGateway.ts](../../../app/server/realtime/chatGateway.ts))
  authenticates merchants by a host-minted shop token, fans out via the Redis adapter, persists
  through `conversationService`, and already collects post-close CSAT (`merchant:csat` →
  `csatService.record`). Announcements broadcast over this socket; NPS mirrors `merchant:csat`.
- **Worker pattern.** Every worker follows `complianceSweep.ts`
  ([complianceSweep.ts](../../../app/server/workers/complianceSweep.ts)): `connection()` from
  `REDIS_URL`, `makeXxxQueue`, `scheduleXxx(appKey, cron)` (idempotent `jobId`, `attempts`,
  exponential backoff), `startXxxWorker` wrapping work in `withTrace` + `worker.on("failed", …
  captureError)`; started + scheduled in [server/start.js](../../../server/start.js) (the Tier-2
  `startOpsRollupWorker`/`scheduleOpsRollup` are already there) and registered in
  [devWorker.ts](../../../app/server/workers/devWorker.ts). The growth rollup is one more clone.
- **RBAC + audit + config.** CASL `Action` union + `defineAbilityFor`
  ([rbac.ts](../../../app/server/rbac.ts)) enforced server-side; the typed audit taxonomy
  ([auditActions.ts](../../../app/lib/auditActions.ts)) is additive-only; all env via the zod
  [config.ts](../../../app/lib/config.ts); tests use the in-memory `FakeDb`
  ([fakeDb.ts](../../../test/helpers/fakeDb.ts)) with real `$transaction` rollback + a `failAudit`
  switch, plus Playwright e2e.

Authority for the choices: roadmap §3.1–3.5 build-vs-buy verdicts (build health/churn/flags/
announcements/plan-change *seam*; buy flag-targeting + announcement-platform); roadmap "honest
gaps" (churn scoring + flag tooling rest on **blog-quality** best practice, not verified primary
sources) — so scoring weights are config-tunable and §3.2's retention flow is flagged to re-verify.

## Goals / Non-Goals

**Goals:**

- A per-merchant **health band** (`HEALTHY | AT_RISK | CRITICAL`) + factor breakdown derived
  replica-only, persisted as `MerchantHealthSnapshot` rollups, surfaced on the 360 panel and a
  portfolio **at-risk** list — no live joins.
- An **uninstall/churn flow**: ingest `app/uninstalled`, record a `MerchantLifecycleEvent`,
  recompute churn KPIs, audit it, and **reconcile retention with the 30-day redaction SLA** without
  the control plane ever redacting app data itself.
- A **boolean feature-flag** registry (per-app flag + per-shop override + deterministic percentage
  bucket) read by the app via a narrow authenticated endpoint, managed by ADMINs.
- **In-app announcements** broadcast over the chat gateway + **NPS** collected through the widget
  (CSAT pattern), rolled into `KpiSnapshot`.
- A **merchant-facing self-serve plan change** that reads plans via `billingService` and dispatches
  the mutation to the app admin API (never a direct CP mutation), with a support-conversation
  fallback.
- Preserve every invariant: replica-only reads, same-tx append-only audit, server-side CASL,
  no app-DB writes, `process.env` only in `config.ts`; **zero** connector-interface edits.

**Non-Goals:**

- A **feature-flag platform** with experiments, multivariate flags, segment targeting, or audit of
  every evaluation (roadmap **buy** — LaunchDarkly/Flagsmith/Unleash). We ship boolean + override +
  one percentage knob.
- A **changelog/announcement/NPS product** (roadmap **buy** — Beamer/Canny): rich scheduling,
  read-receipts, in-app tours, NPS trend analytics. We ship a broadcast + a single `nps` metric.
- A **billing ledger** or any direct Shopify billing mutation from the control plane (architecture
  invariant) — plan changes go through the app admin API or fall back to a ticket.
- **ML/predictive churn models** — the score is a transparent weighted sum of observable signals,
  tunable in `config.ts`, not a trained model.
- Building the embedded **widget UI** itself or the SaleSwitch admin-API endpoints — those are
  app-side; this change builds the control-plane seam + the merchant-facing surfaces that consume
  them, and degrades gracefully where they are absent.
- Changing the realtime transport, the connector contract, or onboarding app #2.

## Decisions

### D1 — Merchant health: a pure scorer + a `MerchantHealthSnapshot` rollup (no live joins)

A pure `app/lib/healthScore.ts` takes the observable signals — subscription status (cancelled /
none / trial / active), open `BillingAlert`s (cap-approaching), usage recency (last-active /
campaign counts from the connector), support pressure (open conversation count, latest CSAT), and
lifecycle (uninstalled / approaching uninstall) — and returns a `{ score, band, factors }` via a
**weighted sum** with config thresholds (`HEALTH_*` weights + the `AT_RISK`/`CRITICAL` cutoffs).
`merchantHealthService.evaluate(appKey, shop)` gathers the signals (connector replica reads +
CP-table reads — never the app primary, never raw SQL) and calls the scorer; the **growth-rollup**
worker (D6) persists the latest `{ score, band, factors }` per shop into a CP-owned
`MerchantHealthSnapshot` (`appKey, shop, score, band, factors Json, asOf`). The 360 panel and the
at-risk list read the **latest snapshot per shop** (same shape as `KpiService.latest`), so the
dashboard invariant ("read pre-aggregated rows, not live joins") holds. **Alternatives rejected:**
(a) computing health live on every panel load — rejected, it would live-join the replica on a hot
path (violates the invariant + adds replica lag to the panel); (b) a trained churn model — rejected
(roadmap "Later"/unverified, and unexplainable to the support team); (c) storing health as a
`KpiSnapshot` metric — rejected, health is *per-shop* with a structured factor breakdown, so a
dedicated per-shop table is cleaner than overloading the portfolio-metric table.

### D2 — Uninstall/churn: a new `lifecycle` topic category + a `MerchantLifecycleEvent`, redaction stays the compliance flow's job

Add `app/uninstalled` to [shopifyWebhook.ts](../../../app/lib/shopifyWebhook.ts) as a new
`LIFECYCLE_TOPICS` set and extend `topicCategory` to return `"lifecycle"`; route that branch in
[webhookProcessor.ts](../../../app/server/services/webhookProcessor.ts) to a new
`lifecycleService.handleWebhook(event)`. The handler records a CP-owned `MerchantLifecycleEvent`
(`appKey, shop, kind LifecycleKind, occurredAt, reason?`), audits `merchant.uninstalled` **in the
same transaction** (mirroring `billingMonitor.onCapApproaching`), and recomputes the churn KPIs by
re-running the rollup (`KpiService.runRollup` already recomputes uninstalls 7/30d from the replica).
A reinstall (`app/uninstalled` is the only uninstall signal; reinstall is detected when a previously-
uninstalled shop reappears active in the rollup) records a `REINSTALL` event. **Retention
reconciliation (the roadmap open question):** the uninstall flow **does not redact** — Shopify
sends `shop/redact` (and `customers/redact`) on its own ~48h-after-uninstall schedule, which the
Tier-0 `ComplianceRequest` 30-day SLA already handles. What this tier adds is a documented CP-owned
**retention policy** (`docs/churn-retention.md`): when the `shop/redact` request for an uninstalled
shop **completes**, the control plane purges its **own** PII-bearing records for that shop
(merchant notes/conversation bodies that may quote PII) — the append-only `AuditLog` is **never
deleted** (it carries only shop domain + structured fields, not raw customer PII). Idempotency rides
the Tier-2 webhook dedupe (`shopifyWebhookId` + content-hash), so a replayed uninstall yields one
event. **Alternatives rejected:** (a) redacting app data from the uninstall handler — rejected,
violates "control plane never mutates the app DB" and races Shopify's own redaction; (b) folding
uninstall into `billingMonitor` — rejected, lifecycle is a distinct concern (and churn KPIs ≠
billing alerts), so a dedicated `lifecycleService` + topic category keeps the fan-out readable.

### D3 — Feature flags: a boolean registry + per-shop override + a deterministic bucket; the app *reads*, CP never writes the app DB

Two CP-owned models: `FeatureFlag` (`appKey, key @unique-per-app, description, defaultEnabled,
rolloutPercentage Int?`) and `FeatureFlagOverride` (`appKey, flagKey, shop, enabled`,
unique per `(appKey, flagKey, shop)`). A pure `app/lib/featureFlagEval.ts` computes
`isEnabled(flag, override?, shop)` = **override if present → percentage bucket** (a stable
`sha256(appKey:key:shop) % 100 < rolloutPercentage`, deterministic so a shop never flickers) **→
default**. `featureFlagService` does CRUD (ADMIN, `flags:manage`, audited `feature.flag.*`) +
`evaluateForShop(appKey, shop)`. Exposure to the SaleSwitch app is a **narrow authenticated read
endpoint** — a resource route `app/routes/api.flags.tsx` that authenticates the app (a shared
service token from the secrets/config seam, or the same shop-token mechanism) and returns the
evaluated map; the control plane **never writes flags into the app DB** (the app *pulls*). This
generalizes the existing app-level `App.enabledModules` primitive to the per-shop level. **Anything
beyond boolean + one percentage knob (segments, experiments, scheduled ramps) is the roadmap buy
verdict** and a non-goal. **Alternatives rejected:** (a) pushing flags into the app DB — rejected
(app-DB-write invariant); (b) a full targeting engine — rejected (buy); (c) reusing
`App.enabledModules` alone — rejected, it is app-wide only, with no per-shop override or rollout.

### D4 — Announcements + NPS: broadcast over the existing chat gateway; NPS mirrors CSAT

`Announcement` (`appKey, title, body, audience AnnouncementAudience (ALL | PLAN | SHOP_LIST),
audienceValue String?` for the plan/shop-list, `publishedAt, expiresAt?`) is published by an
authorized user (`announcements:manage`, audited `announcement.publish`). Broadcast reuses
[chatGateway.ts](../../../app/server/realtime/chatGateway.ts): `announcementService.publish`
resolves the audience to connected shops and emits a Socket.IO `announcement` event (Redis-fanned),
and persists a `SYSTEM` `Message` per targeted conversation (via `conversationService`) so it shows
in history — exactly the `senderType: SYSTEM` path the gateway already supports. **NPS** mirrors the
existing CSAT path: add a `merchant:nps` socket handler beside `merchant:csat`, calling
`npsService.record(conversationId|shop, score 0–10, comment?)` → a CP-owned `NpsResponse`
(idempotent within a survey window, audited `nps.recorded`), acknowledged like `csat:ack`. The
growth rollup (D6) aggregates `NpsResponse` into a `KpiSnapshot` `nps` metric (a standard NPS
promoters−detractors computation) that also feeds D1's support-pressure factor. **Alternatives
rejected:** (a) a separate announcement transport/WebSocket — rejected, the chat gateway already
fans out to every connected widget with Redis; (b) an NPS analytics product — rejected (buy,
Beamer/Canny); (c) email broadcast — rejected, the in-app widget is the channel the roadmap names.

### D5 — Self-serve billing: read via `billingService`, dispatch the mutation to the app admin API, fall back to a ticket

The merchant-facing surface (shop-token authenticated, like the widget — **not** CASL, since the
actor is a merchant, not a staff user) reads current + available plans via
`billingService.getSubscription(shop)` ([billingService.ts](../../../app/server/services/billingService.ts))
(TTL-cached, stale-while-error) and the connector's plan catalog. A plan-change request records a
CP-owned `PlanChangeRequest` (`appKey, shop, fromPlan?, toPlan, status PlanChangeStatus
(REQUESTED | DISPATCHED | COMPLETED | FAILED), confirmationUrl?, externalRef?`) and **dispatches to
the narrow SaleSwitch admin API** — the *exact* pattern of `complianceService.autoDispatch`: POST to
`${SALESWITCH_ADMIN_API_URL}/admin/billing/plan-change` with a bearer token, the app performs the
Shopify managed-pricing mutation and returns a confirmation URL, and CP audits
`billing.plan.change.dispatched`/`.completed`/`.failed` in-tx. The control plane performs **no
direct billing mutation** and writes **no app DB**. **Graceful fallback:** when
`isAppAdminApiConfigured()` is false, `planChangeService` degrades to opening a support
`Conversation` (via `conversationService`) capturing the requested plan — the merchant is still
served and the request is tracked, never a direct mutation. **Alternatives rejected:** (a) the
control plane calling Shopify's Billing API directly — rejected, CP holds no per-shop token and that
would make it a billing actor (invariant); (b) blocking the feature entirely until D2/admin-API
exists — rejected, the ticket fallback ships value now; (c) gating it behind CASL — rejected, the
actor is the merchant on a shop token, the same auth the chat widget uses.

### D6 — One `growthRollup` worker, cloned from `complianceSweep`

A single repeatable worker `app/server/workers/growthRollup.ts` (clone of
[complianceSweep.ts](../../../app/server/workers/complianceSweep.ts): `connection()`,
`makeGrowthRollupQueue`, `scheduleGrowthRollup(appKey, GROWTH_ROLLUP_CRON)`, `startGrowthRollupWorker`
with `withTrace` + `worker.on("failed", … captureError)`) does three things per tick: refresh
`MerchantHealthSnapshot` for active merchants (D1), recompute churn aggregates from
`MerchantLifecycleEvent` (D2), and aggregate `NpsResponse` into the `nps` `KpiSnapshot` (D4). It is
started + scheduled in [server/start.js](../../../server/start.js) beside the KPI/compliance/SLA/ops
sweeps and added to [devWorker.ts](../../../app/server/workers/devWorker.ts). **Alternatives
rejected:** (a) three separate workers — rejected, one tick keeps scheduling simple and the data
sources overlap (health reads NPS + churn); (b) folding into the Tier-2 `opsRollup` — rejected, ops
metrics are infra health (queues/webhooks) and growth metrics are merchant-facing; keeping them
separate keeps each worker's failure blast-radius and cadence independent.

### D7 — Audit taxonomy: additive constants only

Extend [auditActions.ts](../../../app/lib/auditActions.ts) with `merchant.health.evaluated`
(SYSTEM/JOB), `merchant.uninstalled`/`merchant.reinstalled` (SYSTEM/JOB), `feature.flag.create|update|delete`
+ `feature.flag.override.set|clear`, `announcement.publish|expire`, `nps.recorded`, and
`billing.plan.change.requested|dispatched|completed|failed`. No `AuditLog` schema change — the
Tier-1 structured fields (`actorType`, `source`, `actorEmail`) already carry job-vs-UI provenance;
worker/merchant-sourced rows pass `source: JOB`/`actorType: SYSTEM` (or a `system:merchant` actor for
widget-sourced NPS, mirroring `system:webhook`). The audit viewer
([audit.tsx](../../../app/routes/audit.tsx)) gains the new actions in its filter set.

### D8 — RBAC: `flags:manage` + `announcements:manage` (ADMIN); reads under `view`; merchant surfaces on the shop token

Add `flags:manage` and `announcements:manage` to the CASL `Action` union
([rbac.ts](../../../app/server/rbac.ts)), both ADMIN-only (managing a dark-launch or a broadcast is a
privileged, portfolio-wide action). Health reads (the 360 panel + at-risk list) stay under the
existing `view` ability (every authenticated staff user). The merchant-facing surfaces — the flag
read endpoint, the NPS submission, and the self-serve billing flow — are **not** behind CASL: the
flag endpoint uses a service/shop token, and NPS + billing ride the host-minted shop token the chat
widget already uses. **Alternative rejected:** a single `growth:manage` ability — rejected, flags and
announcements are distinct privileges a team may want to grant separately later; two narrow abilities
cost nothing now.

### D9 — One additive migration; existing rows preserved; guard green

All schema changes are additive: seven new CP-owned models (`MerchantHealthSnapshot`,
`MerchantLifecycleEvent`, `FeatureFlag`, `FeatureFlagOverride`, `Announcement`, `NpsResponse`,
`PlanChangeRequest`) + four enums (`HealthBand`, `LifecycleKind`, `AnnouncementAudience`,
`PlanChangeStatus`). No existing model or column changes, so existing rows are untouched and the new
read paths simply find nothing until data accrues. `KpiSnapshot` is unchanged (the `nps` metric is
new rows). `scripts/check-no-app-db-writes.mjs` stays green — every new model is control-plane-owned
and merchant data stays replica-only-read. Applied via `db push`/`migrate-dev` against the local DB,
then `prisma generate`.

## Risks / Trade-offs

- **Health scoring is best-practice, not verified** (roadmap "honest gaps") → The score is a
  transparent weighted sum in a pure `healthScore.ts` with weights/cutoffs in `config.ts`, so the
  team can tune it without code changes; the factor breakdown is always shown so a band is never a
  black box.
- **Snapshot staleness** (health read from the last rollup, not live) → Every health surface shows
  its `asOf` (the same "as of" discipline as replica reads); the rollup cadence
  (`GROWTH_ROLLUP_CRON`) is config-tunable, and a billing/uninstall webhook can trigger an
  out-of-band recompute for the affected shop if freshness matters.
- **Retention/redaction reconciliation is the roadmap's open question** → The control plane never
  redacts app data; it only purges its **own** PII-bearing records once the compliance `shop/redact`
  completes, and never the append-only audit. The exact policy is documented in
  `docs/churn-retention.md` and **flagged for team + legal confirmation** before the purge step is
  enabled (ship the uninstall record + KPI first; the purge is a guarded follow-on).
- **Percentage-rollout flicker** (a shop flipping in/out of a bucket as percentage changes) →
  Bucketing is a deterministic `hash(appKey:key:shop)`, so a fixed percentage is stable per shop and
  raising the percentage only ever *adds* shops (monotonic ramp); an explicit override always wins.
- **Announcement spam / wrong audience** → Audience is explicit (ALL / PLAN / SHOP_LIST), publishing
  is ADMIN-only + audited, and announcements honor expiry; the `SYSTEM` message makes every broadcast
  visible in conversation history for accountability.
- **Self-serve billing depends on the app admin API (D2) + Shopify managed pricing** → Without the
  admin API the flow degrades to a support conversation (no dead end, no direct mutation); the
  control plane is never a billing actor, so the worst case is "the merchant files a ticket", which
  is today's status quo.
- **Merchant-facing surfaces widen the attack surface** → They authenticate with the same host-minted,
  shop-scoped token + explicit CORS the chat widget already uses
  ([sessionToken](../../../app/server/realtime/sessionToken.ts) / `isAllowedOrigin`); the flag read
  endpoint is token-guarded and returns only that shop's flags (no PII, no other shops).
- **Scope creep toward flag/announcement/NPS platforms** → Hard non-goals above; boolean + one
  percentage knob, a broadcast + a single `nps` metric. Rich targeting/experiments/changelog are the
  roadmap buy verdicts.

## Migration Plan

1. Land the single additive Prisma migration (7 models + 4 enums) via `migrate-dev`; regenerate the
   client; confirm `check-no-app-db-writes.mjs` green.
2. Ship **cp-uninstall-churn**: `app/uninstalled` topic + `lifecycleService` + `MerchantLifecycleEvent`
   + churn-KPI recompute — pure addition to the webhook fan-out; existing topics keep flowing. Defer
   the retention *purge* step behind a config flag pending team confirmation (`docs/churn-retention.md`).
3. Ship **cp-merchant-health**: `healthScore.ts` + `merchantHealthService` + `MerchantHealthSnapshot`,
   the `growthRollup` worker, and the 360-panel band + at-risk list. Start + schedule the worker in
   [server/start.js](../../../server/start.js) (`startGrowthRollupWorker()` + `scheduleGrowthRollup("saleswitch")`)
   and [devWorker.ts](../../../app/server/workers/devWorker.ts).
4. Ship **cp-feature-flags**: models + `featureFlagEval.ts` + `featureFlagService` + the
   `api.flags.tsx` read endpoint + the ADMIN management UI + `flags:manage`.
5. Ship **cp-announcements-nps**: models + `announcementService` (chat-gateway broadcast) +
   `npsService` + the `merchant:nps`/`announcement` gateway handlers + the `nps` rollup + the ADMIN
   announcements UI + `announcements:manage`.
6. Ship **cp-self-serve-billing**: `PlanChangeRequest` + `planChangeService` (app-admin-API dispatch
   with the ticket fallback) + the merchant-facing surface + the admin `plan-requests` view.
7. **Rollback:** code revert is safe — every model is new and unreferenced by existing data, no
   column/enum on an existing model changed. Reverting stops the growth rollup, hides the new routes,
   and lets `app/uninstalled` fall back to `other` (acknowledged no-op) again. No data loss, no broken
   reads.

## Open Questions

1. **Health weights + cutoffs** — confirm the signal weights and the `AT_RISK`/`CRITICAL`
   thresholds (proposed: config defaults, tuned after observing real distributions); which usage
   signal the connector can cheaply expose (last-active vs. campaign counts).
2. **Retention/redaction policy (roadmap open)** — confirm with the team/legal *which* CP-owned
   records are purged for a churned shop and *when* (proposed: on `shop/redact` completion; audit
   never purged), before enabling the purge step.
3. **Reinstall detection** — `app/uninstalled` is the only lifecycle webhook; confirm whether a
   dedicated install/reinstall signal exists or reinstall is inferred from the rollup (proposed:
   inferred — a previously-uninstalled shop reappearing active).
4. **Flag read-endpoint auth** — confirm the app authenticates to `/api/flags` with a shared service
   token (config/secrets) vs. the per-shop host-minted token (proposed: service token, since the app
   polls server-side).
5. **Self-serve billing admin-API contract** — confirm the SaleSwitch admin-API endpoint for a plan
   change and its response shape (managed-pricing confirmation URL vs. created-subscription id), and
   who owns building it (ties to PRD D2 / open question §14.5).
6. **NPS cadence + audience** — confirm the survey window (how often a shop is re-surveyed) and
   whether NPS rides the post-close CSAT moment or is a separate trigger.
7. **Worker cadence** — confirm `GROWTH_ROLLUP_CRON` (proposed: less frequent than the ops rollup,
   e.g. daily/hourly, since health/churn move slowly).
