## Why

Tiers 0 and 1 made the control plane *compliant* (App-Store-gating: webhooks, GDPR/DSR,
PCD, billing) and *productive* (a real support desk + merchant-success surface). What it is
**not yet** is *operable at scale*: when SaleSwitch grows — and the moment app #2 onboards —
the team has no single pane on portfolio health, no way to know a BullMQ queue is backed up
or a Shopify webhook silently failed, no SLO/error-budget discipline, no merchant-facing
status surface, and an RBAC model (`ADMIN | SUPPORT | VIEWER`) that grants standing PII
access rather than *justified, time-boxed* access. These are the roadmap's **Tier 2
"scale-readiness (ops resilience)"** items (§2.1–2.5). They ride seams we already own — BullMQ
(which ships **first-party** Prometheus metrics, no exporter needed), the `WebhookEvent`
ledger, `KpiSnapshot` rollups, Tremor, CASL, the same-transaction append-only `AuditLog`,
Sentry — so most of this is **build** on existing rails; the two genuinely-vendor pieces
(on-call paging, a branded public status page) are **buy**, where this change builds only the
*seam* (a scraped `/metrics`, health probes, synthetic scripts) and *authors the policy*.

## What Changes

- **Portfolio health / monitoring dashboard (roadmap §2.1)** — a `/metrics` Prometheus
  endpoint exporting BullMQ's native `bullmq_job_count{queue,state}` plus webhook
  delivery-failure / dead-letter / compliance-breaching counters; an `opsMetricsService`
  that reads live BullMQ job counts (`getJobCounts()`) per queue and derives per-app health;
  an **ops rollup** BullMQ worker (cloned from `complianceSweep`) that persists ops KPIs into
  the existing `KpiSnapshot` so trend tiles render from pre-aggregated rows; and a per-app
  **monitoring** route (Tremor tiles: queue backlog/failures, webhook failure rate, Sentry
  error-rate link, worker liveness).
- **Webhook reliability layer (roadmap §2.4)** — harden the existing `WebhookEvent` ledger to
  true at-least-once: add a **content-hash** dedupe alongside the existing `shopifyWebhookId`
  unique key; track `attempts` and persist retry state; on exhaustion transition to a new
  `DEAD_LETTER` status instead of a terminal `FAILED`; a **failed/dead-letter deliveries
  view** and an ADMIN-only **replay/retry** that re-enqueues a dead-lettered event — every
  replay and dead-letter transition audited.
- **SLO-based alerting & on-call policy (roadmap §2.2)** — an `sloPolicy` module (mirroring
  `slaPolicy`) encoding objectives + **multiwindow multi-burn-rate** thresholds (Google SRE:
  page at 14.4×/6×, ticket at 1×); an `sloService` that evaluates burn rate over the persisted
  ops-metric windows and **emits alert signals** through the existing `captureError`/Sentry
  sink (the bought paging/on-call vendor consumes these — we **buy the plumbing, author the
  policy**, documented in `docs/slo-policy.md`).
- **Public status page + synthetic checks (roadmap §2.3)** — `/healthz` (liveness) and
  `/readyz` (readiness: DB + Redis reachable) resource routes, plus **Playwright synthetic
  transaction** scripts (login → merchant search → inbox, real Chrome, screenshot on failure)
  reusing the in-repo Playwright e2e harness. The **branded public status page is bought**
  (Better Stack / Statuspage / Hyperping); this change builds only the probes + synthetic
  scripts it monitors and documents the incident-comms cadence.
- **Deeper RBAC + justified PII access / break-glass (roadmap §2.5)** — a CP-owned
  `BreakGlassGrant` (typed reason, scope, optional approver, expiry); revealing PII or
  impersonating now requires an **active grant** (a typed reason + time-box), with manager
  approval configurable for sensitive scopes — directly satisfying Shopify PCD §0.2
  ("limit staff access… keep an access log… "). Adds an `impersonate` ability; every
  grant request/approve/activate/revoke/expire is audited.
- **Schema** — add a CP-owned `BreakGlassGrant` model + `BreakGlassScope`/`BreakGlassStatus`
  enums; extend `WebhookEvent` (`contentHash`, `attempts`, `lastAttemptAt`) and the
  `WebhookStatus` enum (`DEAD_LETTER`); extend the audit taxonomy with `webhook.*` and
  `breakglass.*` actions. Ops metrics reuse `KpiSnapshot` — **no new metrics table**. One
  additive Prisma migration; `check-no-app-db-writes.mjs` stays green (every new model is
  CP-owned).

## Capabilities

### New Capabilities
- `cp-ops-monitoring`: a per-app portfolio-health surface — a token-guarded `/metrics`
  Prometheus endpoint (BullMQ-native counters + webhook/compliance gauges), an ops-KPI rollup
  into `KpiSnapshot`, and a Tremor monitoring route showing queue backlog/failures, webhook
  failure rate, worker liveness, and Sentry error-rate.
- `cp-webhook-reliability`: at-least-once hardening of the `WebhookEvent` ledger — content-hash
  dedupe, persisted attempt tracking with capped backoff, a `DEAD_LETTER` terminal state, a
  failed-delivery view, and audited ADMIN replay/retry.
- `cp-slo-alerting`: SLO targets + multiwindow multi-burn-rate evaluation over the persisted
  ops metrics, emitting page/ticket alert signals to the (bought) on-call vendor via the
  Sentry sink; the on-call/error-budget policy is authored as config + `docs/slo-policy.md`.
- `cp-status-synthetics`: liveness/readiness probes (`/healthz`, `/readyz`) and Playwright
  synthetic transaction checks (screenshot-on-failure) that feed a bought public status page;
  documented incident-comms cadence.
- `cp-break-glass-rbac`: justified, time-boxed elevated access — a `BreakGlassGrant` gating
  PII reveal and a new impersonation ability, with a required typed reason, optional manager
  approval for sensitive scopes, automatic expiry, and full audit of every transition.

### Modified Capabilities
<!-- No spec files exist under openspec/specs/ yet (Tiers 0 and 1 captured behavior as new
     capabilities, not deltas to a prior main spec). The Tier-2 enhancements build on
     Tier-0/Tier-1 behavior that lives in code (the WebhookEvent ledger, the audit taxonomy,
     the slaPolicy/sweep pattern, the PII-reveal flow), referenced from design.md, so they are
     captured as the new capabilities above rather than as deltas. -->

## Impact

- **New code**: `prisma` model `BreakGlassGrant`; services `opsMetricsService.ts`,
  `sloService.ts`, `breakGlassService.ts`, `webhookRetryService.ts` (or methods on
  `webhookService.ts`); pure policy modules `app/lib/sloPolicy.ts`; an ops-rollup worker
  `app/server/workers/opsRollup.ts` + scheduler; resource routes `app/routes/metrics.tsx`
  (`/metrics`), `app/routes/healthz.tsx` (`/healthz` + `/readyz`); a `app/routes/monitoring.tsx`
  Tremor ops dashboard; tRPC routers `routers/monitoring.ts`, `routers/webhooks.ts` (DLQ
  list/replay), `routers/breakGlass.ts` (register each in `trpc/root.ts`); Playwright
  synthetic scripts under `e2e/synthetics/`; `docs/slo-policy.md` + `docs/status-page.md`.
- **Modified code**: `prisma/schema.prisma` (1 new model + `WebhookEvent` columns +
  `WebhookStatus DEAD_LETTER` + 2 new enums, 1 migration); `app/lib/auditActions.ts`
  (`webhook.*`, `breakglass.*` actions); `app/server/services/webhookService.ts` +
  `webhookProcessor.ts` + `app/server/workers/webhookProcess.ts` (content-hash dedupe,
  attempts, dead-letter transition); `app/server/rbac.ts` (`ops:view` + `impersonate`
  abilities; gate PII reveal behind an active grant); `app/lib/pii.ts` /
  `merchant-detail.tsx` reveal path (require a grant); `app/routes.ts` (register
  `/metrics`, `/healthz`, `/readyz`, `monitoring`); `app/routes/audit.tsx` (new action
  filters); `server/start.js` (start + schedule the ops rollup beside the KPI/compliance/SLA
  sweeps); `app/lib/config.ts` (SLO thresholds, `METRICS_AUTH_TOKEN`, webhook max-attempts,
  break-glass TTL/approval flags); `app/lib/secrets.ts` if the status-page/paging vendor
  needs a key.
- **Invariants preserved**: replica-only reads (monitoring reads BullMQ/Redis + CP tables, never
  the app DB; no raw SQL); same-transaction append-only audit (webhook-replay, dead-letter,
  every break-glass transition audit in-tx); server-side CASL RBAC (the new abilities + the
  grant check are enforced in tRPC middleware, never just the UI); control plane never writes
  the app DB (`BreakGlassGrant` is CP-owned; `WebhookEvent` is CP-owned); `process.env` only in
  `config.ts`. **No connector-interface change** → app #2 stays one connector + one registry row,
  and the monitoring tiles enumerate apps via the existing `appRegistryService`.
- **Build vs. buy (explicit, from the roadmap table)**: **Build** — monitoring instrumentation
  (BullMQ-native), webhook reliability, break-glass RBAC, the `/metrics` + `/healthz`/`/readyz`
  seams, the SLO burn-rate computation, and the synthetic scripts. **Buy** — the on-call/paging
  vendor (§2.2 plumbing) and the branded public status page (§2.3); this change emits the
  signals/probes they consume and authors the policy, but does **not** build a pager or a status
  page. **Already bought** — Sentry (wired); §2.1 surfaces its error-rate.
- **Dependencies / assumptions**: BullMQ's `getJobCounts()` / `exportPrometheusMetrics` are
  available on the installed version (verify in tasks); the `/metrics` endpoint sits behind the
  zero-trust gateway and is additionally token-guarded; SLO multi-burn-rate is noted (roadmap
  §2.2 caveat) to fit poorly at very low traffic — ship the policy, start with the simpler
  burn-rate windows and graduate; the public status page + pager are external SaaS chosen at
  apply time (no code dependency, only config/secrets).
