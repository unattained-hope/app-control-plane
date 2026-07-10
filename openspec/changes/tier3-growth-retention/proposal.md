## Why

Tiers 0–2 made the control plane *compliant* (App-Store webhooks/GDPR/PCD/billing), *productive*
(a real support desk + merchant-success surface), and *operable at scale* (monitoring, webhook
durability, SLO alerting, break-glass RBAC). What it still cannot do is help the team **grow and
keep** the merchant base: there is no way to see which SaleSwitch merchants are *at risk*, no
flow when one *uninstalls*, no lever to *dark-launch* a Badgy feature to a subset of shops, no
channel to *announce* changes or gauge sentiment (NPS), and no merchant-facing path to *change
plan* without opening a ticket. These are the roadmap's **Tier 3 "Later / strategic (growth &
retention)"** items (§3.1–3.5). Now that §0.3 (billing monitoring) and the Tier-1 inbox/CSAT
loop have landed, the foundation those items depend on exists, so they ride seams we already own
— the connector (replica-only reads), `KpiSnapshot` rollups, the BullMQ worker pattern, the
`ComplianceRequest` SLA model, the Socket.IO chat gateway + CSAT pattern, the narrow app-admin-API
dispatch pattern, and the same-transaction append-only `AuditLog`. Per the roadmap's build-vs-buy
table this is mostly **build** on those rails; the two genuinely-vendor pieces (feature-flag
*targeting/experiments*, an announcement/changelog *platform*) are **buy**, where this change
builds only the minimal boolean/broadcast seam and leaves rich targeting to a vendor.

## What Changes

- **Merchant health scoring & churn signals (roadmap §3.1)** — a `merchantHealthService` that
  derives a per-merchant **health score + band** (`HEALTHY | AT_RISK | CRITICAL`) from signals
  already reachable: subscription state + `BillingAlert`s (cap-approaching / cancelled), usage
  recency (connector replica reads), support pressure (open conversations, low CSAT), and
  lifecycle (approaching/after uninstall). A **growth-rollup** BullMQ worker (cloned from
  `complianceSweep`) persists the latest score per shop into a new CP-owned
  `MerchantHealthSnapshot` (read like `KpiSnapshot`, **no live joins** on the dashboard); the
  merchant-360 panel shows the band + factors and a portfolio **"at-risk"** list ranks the
  worst-off shops. No new vendor — derived from data we already read.
- **App-uninstall / churn flow (roadmap §3.2)** — subscribe to **`app/uninstalled`** (a new
  lifecycle topic in the existing webhook ledger), record a CP-owned `MerchantLifecycleEvent`
  (`INSTALL | UNINSTALL | REINSTALL`), recompute the uninstall/churn KPIs, audit
  `merchant.uninstalled`, and **reconcile data-retention with the 30-day redaction SLA**: the
  uninstall does **not** itself redact (Shopify's `shop/redact` / `customers/redact` drive that,
  already handled by Tier-0 `ComplianceRequest`); instead it links the uninstall to the expected
  redaction window and applies a documented CP-owned retention policy (purge CP-owned
  conversation/note PII for a churned shop once redaction completes; the append-only audit log is
  never deleted). Uninstall feeds the health/churn signal (§3.1).
- **Feature flags / staged rollout (roadmap §3.3)** — a **simple boolean** CP-owned flag registry
  (`FeatureFlag` + per-shop `FeatureFlagOverride`) with an `isEnabled(appKey, key, shop)`
  evaluator = override ?? stable-hash percentage bucket ?? default, exposed to the SaleSwitch app
  via a **narrow authenticated read endpoint** (the app polls; CP never writes the app DB) and an
  ADMIN management UI. `App.enabledModules` is the existing app-level primitive this generalizes
  to the per-shop level. Rich targeting/experiments are **out of scope (buy** — LaunchDarkly /
  Flagsmith / Unleash).
- **In-app announcements / changelog + NPS (roadmap §3.4)** — a CP-owned `Announcement`
  (audience: all / by-plan / shop-list, with publish/expiry) **broadcast over the existing chat
  gateway** (a `SYSTEM` message + a Socket.IO `announcement` event, Redis-fanned to connected
  widgets) and an **NPS** survey collected through the widget exactly like the CSAT path
  (`merchant:nps` mirroring `merchant:csat`), persisted to `NpsResponse` and rolled into
  `KpiSnapshot` (an `nps` metric that also feeds §3.1). Build small; a full changelog/NPS platform
  (Beamer / Canny) is the **buy** alternative, noted but out of scope.
- **Self-serve billing portal — merchant-facing (roadmap §3.5)** — a merchant-facing flow
  (embedded, shop-token-authenticated like the chat widget) that reads the merchant's current
  subscription + available plans via `billingService`/the connector and lets them **request a
  plan change**. Because the control plane holds no per-shop Shopify token and never mutates the
  app DB, the change is **dispatched to the narrow SaleSwitch admin API** (the same pattern as
  `complianceService.autoDispatch`), which performs the Shopify managed-pricing mutation and
  returns a confirmation URL; CP records an audited CP-owned `PlanChangeRequest`. When the app
  admin API (D2) is **not** configured this degrades gracefully to opening a support conversation
  — never a direct billing mutation from the control plane.
- **Schema** — five CP-owned models (`MerchantHealthSnapshot`, `MerchantLifecycleEvent`,
  `FeatureFlag`, `FeatureFlagOverride`, `Announcement`, `NpsResponse`, `PlanChangeRequest`) + the
  enums they need (`HealthBand`, `LifecycleKind`, `AnnouncementAudience`, `PlanChangeStatus`); the
  audit taxonomy gains `merchant.health.*`, `merchant.uninstalled`/`reinstalled`,
  `feature.flag.*`, `announcement.*`, `nps.recorded`, and `billing.plan.change.*` actions. One
  additive Prisma migration; `check-no-app-db-writes.mjs` stays green (every new model is
  CP-owned; merchant data stays replica-only-read).

## Capabilities

### New Capabilities
- `cp-merchant-health`: a per-merchant health score + band derived (replica-only) from
  subscription/billing/usage/support/lifecycle signals, persisted as `MerchantHealthSnapshot`
  rollups, surfaced on the merchant-360 panel and a portfolio at-risk list — no live joins.
- `cp-uninstall-churn`: `app/uninstalled` ingestion into a `MerchantLifecycleEvent`, churn-KPI
  recompute, an audited uninstall record, and a documented retention policy reconciled with the
  Tier-0 30-day redaction SLA (the control plane never redacts app data itself).
- `cp-feature-flags`: a simple boolean per-app/per-shop flag registry with an `isEnabled`
  evaluator (override ?? percentage bucket ?? default) exposed to the app via a narrow
  authenticated read endpoint and an ADMIN management UI — rich targeting is bought.
- `cp-announcements-nps`: CP-owned announcements broadcast over the chat gateway to embedded
  widgets, and an NPS survey collected through the widget (CSAT pattern), persisted and rolled
  into `KpiSnapshot`.
- `cp-self-serve-billing`: a merchant-facing plan-change request that reads current/available
  plans via `billingService` and dispatches the mutation to the narrow SaleSwitch admin API
  (never a direct CP billing mutation), audited, with a support-conversation fallback when the
  admin API is absent.

### Modified Capabilities
<!-- No spec files exist under openspec/specs/ yet — Tiers 0–2 captured behavior as new
     capabilities, not deltas to a prior main spec (the spec directory has not been populated via
     /opsx:sync). Tier 3 builds on Tier-0/1/2 behavior that lives in code (the WebhookEvent ledger
     + topic routing, the ComplianceRequest 30-day SLA, the chat gateway + CSAT path, billingService
     + the app-admin-API dispatch pattern, KpiSnapshot rollups, the merchant-360 panel), referenced
     from design.md, so the Tier-3 work is captured as the new capabilities above rather than as
     deltas to non-existent main specs. -->

## Impact

- **New code**: `prisma` models `MerchantHealthSnapshot`, `MerchantLifecycleEvent`, `FeatureFlag`,
  `FeatureFlagOverride`, `Announcement`, `NpsResponse`, `PlanChangeRequest` + new enums; services
  `merchantHealthService.ts`, `lifecycleService.ts` (uninstall/churn), `featureFlagService.ts`,
  `announcementService.ts`, `npsService.ts`, `planChangeService.ts`; a pure
  `app/lib/healthScore.ts` (scoring weights) and `app/lib/featureFlagEval.ts` (deterministic
  hash bucket); a `growthRollup` worker `app/server/workers/growthRollup.ts` + scheduler;
  tRPC routers `routers/health.ts`, `routers/flags.ts`, `routers/announcements.ts`,
  `routers/plans.ts` (register in `trpc/root.ts`); RR7 routes `app/routes/at-risk.tsx`,
  `app/routes/feature-flags.tsx`, `app/routes/announcements.tsx`, an admin
  `app/routes/plan-requests.tsx`; merchant-facing resource routes `app/routes/api.flags.tsx`
  (flag read) and a shop-token self-serve billing surface; `merchant:nps` + `announcement`
  handlers on the chat gateway; `docs/feature-flags.md` + `docs/churn-retention.md`.
- **Modified code**: `prisma/schema.prisma` (7 new models + new enums, 1 migration);
  `app/lib/auditActions.ts` (the new actions); `app/lib/shopifyWebhook.ts` (`app/uninstalled` +
  a `lifecycle` category) + `app/server/services/webhookProcessor.ts` (route the lifecycle topic);
  `app/server/rbac.ts` (`flags:manage` + `announcements:manage` ADMIN abilities);
  `app/server/realtime/chatGateway.ts` (announcement broadcast + `merchant:nps`);
  `app/routes/merchant-detail.tsx` (health band + factors on the 360 panel);
  `app/lib/config.ts` (scoring weights/thresholds, rollout-percentage seed, NPS/announcement and
  plan-change/retention knobs); `app/routes.ts` (register the new routes); `app/routes/audit.tsx`
  (new action filters); `server/start.js` + `app/server/workers/devWorker.ts` (start + schedule
  the growth rollup beside the existing sweeps).
- **Invariants preserved**: replica-only reads (health/usage read via the connector; no raw SQL);
  same-transaction append-only audit (every lifecycle/flag/announcement/plan-change/health
  transition audits in-tx); server-side CASL RBAC (the new abilities enforced in tRPC middleware,
  never just the UI; merchant-facing surfaces use the shop-scoped token, not CASL); control plane
  never writes the app DB (all seven models are CP-owned; plan changes go through the app admin
  API; flags are *read* by the app, never written by CP into it); `process.env` only in
  `config.ts`. **No connector-interface change** → app #2 stays one connector + one registry row,
  and health/flags/announcements enumerate apps via the existing `appRegistryService`.
- **Build vs. buy (explicit, from the roadmap table)**: **Build** — health scoring, the uninstall/
  churn flow, the boolean flag registry, the minimal announcement/NPS broadcast, and the
  plan-change *request* seam. **Buy (out of scope here)** — feature-flag targeting/experiments
  (LaunchDarkly/Flagsmith/Unleash) beyond boolean + percentage, and a full announcement/changelog/
  NPS *platform* (Beamer/Canny). **Already bought** — Sentry (errors/traces on the new worker).
- **Dependencies / assumptions**: §3.4 (announcements/NPS) and §3.5 (self-serve billing) are
  **merchant-facing** and depend on the embedded SaleSwitch widget being live and, for §3.5, on
  the **narrow app admin API (D2)** + Shopify managed pricing — absent D2, §3.5 degrades to a
  support-conversation fallback. §3.2's exact retention/redaction reconciliation is a roadmap
  **open question** ("re-verify exact flow") — documented in `docs/churn-retention.md` and
  flagged for team confirmation. §3.1 scoring weights are best-practice (not independently
  verified, per the roadmap's "honest gaps") and are one-file tunable in `config.ts`.
