## Context

Tier 0 ([tier0-app-store-gating](../tier0-app-store-gating/proposal.md)) cleared the
App-Store floor; Tier 1 ([tier1-support-merchant-success](../tier1-support-merchant-success/proposal.md))
turned the inbox into a real desk. Tier 2 is **ops resilience**: making the portfolio
observable, the webhook path durable, the alerting principled, and PII access justified — so
the control plane survives merchant growth and app #2. This change rides existing seams
(verified against the codebase):

- **BullMQ workers (the clone target).** Every worker follows one shape
  ([complianceSweep.ts](../../../app/server/workers/complianceSweep.ts):
  `connection()` from `REDIS_URL`, `makeXxxQueue()`, `scheduleXxx(appKey, cron)` with
  `repeat:{pattern}` + idempotent `jobId` + `attempts` + exponential `backoff`,
  `startXxxWorker()` wrapping work in `withTrace()` and binding `worker.on("failed", …
  captureError)`). Workers are started + scheduled in
  [server/start.js](../../../server/start.js) (`startKpiWorker`, `startWebhookWorker`,
  `startComplianceSweepWorker`/`scheduleComplianceSweep`, `startSlaWorker`/`scheduleSlaSweep`).
  BullMQ exposes live job counts (`queue.getJobCounts()`) and a first-party
  `exportPrometheusMetrics()` — no third-party exporter (roadmap §2.1).
- **Webhook ledger (Tier 0).** The ingestion route
  ([webhooks.shopify.tsx](../../../app/routes/webhooks.shopify.tsx)) HMAC-verifies
  ([shopifyWebhook.ts](../../../app/lib/shopifyWebhook.ts) `verifyShopifyHmac`), then
  `WebhookService.ingest`/`recordInvalid`
  ([webhookService.ts](../../../app/server/services/webhookService.ts)) persists a
  `WebhookEvent` and enqueues `enqueueWebhook(id)`; the worker
  ([webhookProcess.ts](../../../app/server/workers/webhookProcess.ts), 5 attempts,
  exponential backoff) runs `processWebhookEvent`
  ([webhookProcessor.ts](../../../app/server/services/webhookProcessor.ts)) and marks
  `PROCESSED`/`FAILED`. Today dedupe is **only** the `WebhookEvent.shopifyWebhookId @unique`
  ([schema.prisma](../../../prisma/schema.prisma)); there is **no** content-hash dedupe, **no**
  dead-letter state, **no** failed-delivery view, **no** replay.
- **Pre-aggregated KPIs.** `KpiSnapshot` ([schema.prisma](../../../prisma/schema.prisma)) is
  appended by the rollup worker ([kpiRollup.ts](../../../app/server/workers/kpiRollup.ts)) and
  read latest-per-metric by `KpiService.latest`
  ([kpiService.ts](../../../app/server/services/kpiService.ts)); the dashboard
  ([dashboard.tsx](../../../app/routes/dashboard.tsx)) renders Tremor cards from it — never a
  live join. Ops metrics reuse this exact path.
- **RBAC + PII reveal.** CASL `Action` union + `defineAbilityFor(role)` + `roleCan`
  ([rbac.ts](../../../app/server/rbac.ts)), enforced server-side via `requireAbility(action)`
  ([core.ts](../../../app/server/trpc/core.ts)). PII is masked by default
  ([pii.ts](../../../app/lib/pii.ts) `maskEmail`) and revealed only through an audited
  `revealPii` path (a typed reason → `merchant.pii.view`); `pii:view` is held by SUPPORT+ as a
  *standing* grant today — Tier 2 makes it *justified + time-boxed*.
- **Audit taxonomy (Tier 1).** `AuditService.append(input, tx)` /`query(filter)`
  ([auditService.ts](../../../app/server/services/auditService.ts)) carry structured
  `actorType` (`INTERNAL|SYSTEM`) + `source` (`UI|API|JOB`); the typed action set lives in
  [auditActions.ts](../../../app/lib/auditActions.ts). Tier 2 only **adds** constants.
- **Observability.** `initObservability(scope)` / `captureError(err, ctx)` / `withTrace`
  ([observability.ts](../../../app/lib/observability.ts)) are the Sentry seam (no-op fallback
  to structured logs without a DSN). There is **no** `/healthz`, `/readyz`, or `/metrics`
  route today.
- **Registry + config + tests.** `appRegistryService.listActiveApps()`
  ([appRegistryService.ts](../../../app/server/services/appRegistryService.ts)) enumerates
  apps for per-app tiles; all env access goes through the zod
  [config.ts](../../../app/lib/config.ts); tests use the in-memory `FakeDb` with real
  `$transaction` rollback + a `failAudit` switch
  ([fakeDb.ts](../../../test/helpers/fakeDb.ts)) and Playwright e2e.

Authority for the new policy choices: BullMQ's native Prometheus export (roadmap §2.1, high
confidence); Google SRE multiwindow multi-burn-rate (roadmap §2.2, high); at-least-once
webhook delivery (roadmap §2.4); Shopify PCD controls (roadmap §0.2 / [docs/protected-customer-data.md](../../../docs/protected-customer-data.md)).

## Goals / Non-Goals

**Goals:**

- One per-app **monitoring** surface: BullMQ queue backlog/failures, webhook failure &
  dead-letter counts, compliance-breaching count, worker liveness, Sentry error-rate — from a
  `/metrics` Prometheus endpoint + Tremor tiles fed by a `KpiSnapshot` ops rollup.
- **At-least-once** webhook durability: content-hash dedupe, attempt tracking, a `DEAD_LETTER`
  terminal state, a failed-delivery view, and audited ADMIN replay.
- An authored **SLO/error-budget + on-call policy** with multiwindow multi-burn-rate
  evaluation that emits page/ticket signals to a bought pager via the Sentry sink.
- **Liveness/readiness probes** + Playwright **synthetic** transaction checks feeding a bought
  public status page.
- **Justified, time-boxed PII access + impersonation** (break-glass): a typed reason, optional
  manager approval for sensitive scopes, automatic expiry, fully audited — satisfying Shopify
  PCD §0.2.
- Preserve every invariant: replica-only reads, same-tx append-only audit, server-side CASL,
  no app-DB writes, `process.env` only in `config.ts`; **zero** connector-interface edits.

**Non-Goals:**

- Building a **pager / on-call scheduler** or a **branded public status page** — both bought
  (§2.2/§2.3); this change emits the signals + probes they consume and authors the policy.
- A full metrics/observability stack (OpenTelemetry, Grafana, Prometheus server, ClickHouse) —
  roadmap "Later"; we expose a `/metrics` endpoint and persist trend KPIs, nothing more.
- Full attribute-based / resource-scoped authorization engine (OpenFGA/Oso) — roadmap "Later";
  break-glass adds *justified time-boxed* grants over the existing role model, not a rewrite.
- Auto-remediation (auto-scaling, self-healing queues), webhook **ordering** guarantees, or
  exactly-once semantics — at-least-once + idempotent processing only.
- Changing the realtime transport, the connector contract, or onboarding app #2.

## Decisions

### D1 — Monitoring: live BullMQ counts + a `KpiSnapshot` ops rollup + a token-guarded `/metrics`

An `opsMetricsService` reads **live** per-queue counts via `queue.getJobCounts()` for every
known queue (`kpi-rollup`, `webhook-process`, `compliance-sweep`, `sla-sweep`, `ops-rollup`) —
cheap Redis reads, no DB — plus CP-table gauges (webhook failure/dead-letter counts by
`status`, compliance breaching count). It renders two ways: (a) a **Prometheus text** payload
at a `/metrics` resource route ([routes.ts](../../../app/routes.ts)) — preferring BullMQ's
first-party `exportPrometheusMetrics()` for `bullmq_job_count{queue,state}` and appending our
gauges — for the bought pager/Grafana to scrape; (b) a structured object for the **monitoring**
Tremor route. The `/metrics` route sits behind the zero-trust gateway **and** is additionally
guarded by a `METRICS_AUTH_TOKEN` (config) bearer check, because scrapers authenticate by token,
not SSO. **Trend** tiles (failure rate over time) need history, so a repeatable **`ops-rollup`**
worker (cloned from [complianceSweep.ts](../../../app/server/workers/complianceSweep.ts)) writes
ops gauges as `KpiSnapshot` rows (`metric: "ops.queue.failed.webhook-process"`, etc.), so the
dashboard reads pre-aggregated rows exactly like the KPI dashboard (no live joins for trends;
live counts only for the "now" tiles). **Alternatives rejected:** (a) a third-party exporter —
rejected, BullMQ ships its own (§2.1); (b) a dedicated `OpsMetric` table — rejected, `KpiSnapshot`
already is the time-series-of-floats seam, reuse it; (c) computing trends live on every dashboard
load — rejected, violates the "dashboard from pre-aggregated rows" invariant.

### D2 — Webhook reliability: harden the existing ledger, don't add a DLQ table

Make `WebhookEvent` the durable at-least-once log it was designed to be (its schema comment
already says it "doubles as the failed-delivery log (roadmap §2.4)"):

- **Content-hash dedupe** — add `contentHash String?` (sha-256 of the raw body) with an index;
  `ingest` checks both the existing `shopifyWebhookId @unique` *and* an existing
  same-`(appKey, topic, contentHash)` row, so a redelivery with a fresh webhook-id but identical
  body is still recognized as a duplicate (clock-skew / retry storms). The `shopifyWebhookId`
  unique constraint stays the primary key of idempotency; content-hash is the secondary guard.
- **Attempt tracking + capped backoff** — add `attempts Int @default(0)` and
  `lastAttemptAt DateTime?`; the worker increments `attempts` per run. Keep BullMQ's existing
  exponential backoff but **cap** it (`backoff` delay ceiling) and bound attempts by a config
  `WEBHOOK_MAX_ATTEMPTS` (default 5, matching today).
- **Dead-letter state** — add `DEAD_LETTER` to `WebhookStatus`. On final exhaustion the worker
  transitions `FAILED → DEAD_LETTER` (terminal, never auto-retried) and audits
  `webhook.dead_lettered` (`source: JOB`, `actorType: SYSTEM`). `FAILED` remains the *transient*
  retriable state; `DEAD_LETTER` is the permanent one that surfaces in the view.
- **Failed-delivery view + replay** — a `webhooks` tRPC router lists `FAILED`/`DEAD_LETTER`
  events (filter by topic/status, server-paginated like the merchants grid) and an ADMIN-only
  `webhooks.replay(id)` re-enqueues a dead-lettered event (resets `status: RECEIVED`, leaves
  `attempts` for the record, audits `webhook.replayed` in the same transaction as the re-enqueue).

**Alternatives rejected:** (a) a separate `WebhookEventDLQ` table — rejected, it splits the
delivery ledger and duplicates indexes; a `DEAD_LETTER` status on one table keeps a single
queryable history. (b) Replacing `shopifyWebhookId` dedupe with content-hash — rejected,
Shopify's delivery-id is the canonical idempotency key; content-hash is additive insurance.

### D3 — SLO alerting: author the policy + compute burn-rate; buy the pager

A pure `sloPolicy` module (mirroring [slaPolicy](../../../app/server/services/slaPolicy.ts))
encodes, per SLO (start with **webhook delivery success** and **request availability**): the
objective (e.g. 99.9%), and the Google-SRE **multiwindow multi-burn-rate** alert tiers — **page**
at 14.4× (1h/5m windows, 2% budget), **page** at 6× (6h/30m, 5%), **ticket** at 1× (3d/6h, 10%).
An `sloService.evaluate(appKey)` reads the persisted ops metrics (the `KpiSnapshot` ops rows from
D1) over the short+long windows, computes burn rate, and when a tier fires **emits an alert
signal through `captureError`** (the existing Sentry sink → the bought pager/Slack, configured
Sentry-side) tagged with severity `page`/`ticket` and the SLO id, and audits `slo.alert.fired`
(`source: JOB`). Evaluation runs inside the `ops-rollup` worker tick (D1), so no extra worker.
The on-call rotation, escalation, and error-budget-policy prose live in **`docs/slo-policy.md`**
(authored, not code). **Alternatives rejected:** (a) building paging/on-call scheduling —
rejected (buy, §2.2); (b) hard static thresholds ("alert if failures > N") — rejected, they page
on transient blips and ignore budget; MWMBR fires only while the budget is *actively* burning.
**Caveat honored:** MWMBR fits poorly at very low traffic (§2.2) — the policy doc says start with
the longer windows / a simpler rule and graduate as merchant volume grows; this is a config knob,
not a rewrite.

### D4 — Status + synthetics: build the probes + scripts; buy the status page

Two resource routes: **`/healthz`** (liveness — process up, returns 200 immediately) and
**`/readyz`** (readiness — pings the control-plane DB and Redis; 503 if either is unreachable so
an orchestrator can pull the instance out of rotation). Both are unauthenticated (they expose no
data, only up/down) and registered in [routes.ts](../../../app/routes.ts) outside the `_shell`
layout. **Synthetic** monitoring is Playwright **transaction** scripts under `e2e/synthetics/`
(login → merchant search → open inbox → assert content; real Chrome; **screenshot on failure**)
reusing the in-repo Playwright harness — run from the bought monitor (or CI cron) against a real
environment. The **branded public status page is bought** (Better Stack / Statuspage / Hyperping):
it monitors `/healthz` + the synthetics and renders the public page; `docs/status-page.md`
documents the wiring + the incident-comms cadence (minor every 60 min; major/critical every
15–20 min). **Alternatives rejected:** building a status page (§2.3 buy verdict — mature hosted
options are cheaper and this is the first merchant-facing surface, so an SLA-backed vendor wins);
exposing merchant data from `/healthz` (kept to up/down to stay safely unauthenticated).

### D5 — Break-glass RBAC: a `BreakGlassGrant` gating PII reveal + impersonation

Add a CP-owned `BreakGlassGrant` (`appKey`, `actorUserId`, `scope` `BreakGlassScope`:
`PII_REVEAL | IMPERSONATION`, `targetShop String?`, `reason String`, `status` `BreakGlassStatus`:
`REQUESTED | APPROVED | ACTIVE | EXPIRED | REVOKED | DENIED`, `approverUserId String?`,
`expiresAt DateTime`, timestamps). The flow:

- A user requests a grant with a **typed reason** + scope (+ `targetShop` for a specific
  merchant). For scopes/targets flagged *sensitive* (config), status starts `REQUESTED` and an
  ADMIN must `approve` (→ `ACTIVE`); otherwise it self-activates (`ACTIVE`) with an expiry
  (`BREAK_GLASS_TTL_MINUTES`, default e.g. 30).
- **Enforcement moves into the reveal path, not just the role.** `revealPii` (and the new
  `impersonate` entry point) first calls `requireAbility("pii:view")` (role gate, unchanged)
  **then** `breakGlassService.requireActiveGrant(actor, scope, shop)` which 403s unless an
  unexpired `ACTIVE` grant covers the actor+scope(+shop). So `pii:view` becomes "*eligible* to
  reveal", and a live grant is "*authorized right now*". The existing typed-reason `revealPii`
  audit (`merchant.pii.view`) stays; the grant adds the time-box + (optional) approval.
- Every transition (`requested/approved/denied/activated/revoked/expired`) audits a
  `breakglass.*` action in the same transaction. Expiry is swept by the `ops-rollup` worker tick
  (flip `ACTIVE`→`EXPIRED` past `expiresAt`, audit `breakglass.expired`, `source: JOB`) — no new
  worker.
- A new `impersonate` ability (ADMIN-only) gates impersonation; impersonation requires an
  `IMPERSONATION`-scope active grant and is audited on entry/exit. (Impersonation *UI* is minimal
  in this change — the gate + audit + grant are the deliverable; full impersonated-session UX can
  follow.)

**Alternatives rejected:** (a) a full ABAC/relationship engine (OpenFGA/Oso) — roadmap "Later",
overkill; a small grant table + the existing CASL gate gives justified+time-boxed access now.
(b) Reason-as-a-string-on-the-audit-row only (today's `revealPii`) — rejected, it records *why*
but doesn't *limit* (no expiry, no approval, no scoping); PCD §0.2 wants access *limited*, not
just logged. (c) Storing grants in Redis/session — rejected, they must be queryable + auditable +
survive restarts; a CP table is the audit-friendly home.

### D6 — Audit taxonomy: additive constants only

Extend [auditActions.ts](../../../app/lib/auditActions.ts) with `webhook.replayed`,
`webhook.dead_lettered`, `slo.alert.fired`, and `breakglass.requested|approved|denied|activated|revoked|expired`,
plus an `impersonation.start|end` pair. No schema change to `AuditLog` — the Tier-1 structured
fields (`actorType`, `source`, `actorEmail`) already carry job-vs-UI provenance; worker-emitted
rows pass `source: JOB`/`actorType: SYSTEM`. The audit viewer
([audit.tsx](../../../app/routes/audit.tsx)) gains the new actions in its filter set.

### D7 — RBAC abilities: `ops:view` + `impersonate`

Add `ops:view` (read the monitoring dashboard + webhook DLQ list) and `impersonate` (ADMIN-only)
to the CASL `Action` union ([rbac.ts](../../../app/server/rbac.ts)). `ops:view` is granted to
ADMIN and SUPPORT (ops visibility helps the desk); **mutating** ops actions (`webhooks.replay`,
break-glass `approve`, registry changes) stay ADMIN-only. The `/metrics` and `/healthz`/`/readyz`
routes are **not** behind CASL (token-guarded / unauthenticated respectively) since scrapers and
orchestrators aren't SSO users. **Alternative rejected:** reusing `audit:view` for monitoring —
rejected, ops monitoring is a distinct concern SUPPORT should see while the audit log stays
ADMIN-only.

### D8 — One additive migration; existing rows preserved

All schema changes are additive: one new `BreakGlassGrant` model + two enums
(`BreakGlassScope`, `BreakGlassStatus`); `WebhookEvent` gains nullable `contentHash`,
`attempts Int @default(0)`, `lastAttemptAt DateTime?`; `WebhookStatus` gains `DEAD_LETTER`.
Defaults backfill existing `WebhookEvent` rows (`attempts 0`, null hash) without rewrite, and no
existing webhook is in `DEAD_LETTER`, so the new view/replay paths simply find nothing until a
real exhaustion occurs. `KpiSnapshot` is unchanged (ops metrics are new rows, not new columns).
`scripts/check-no-app-db-writes.mjs` stays green — `BreakGlassGrant` and `WebhookEvent` are both
control-plane-owned.

## Risks / Trade-offs

- **`/metrics` exposes operational detail** → Token-guard it (`METRICS_AUTH_TOKEN`) *in addition*
  to the zero-trust gateway; it carries no merchant PII (only queue/webhook counts). Document
  that the token is a secret, injected via the secrets seam.
- **MWMBR alerting is noisy/ineffective at low traffic** (roadmap §2.2 caveat) → Ship the policy
  but default to the longer windows / a simpler burn rule via config; `docs/slo-policy.md` states
  the "graduate as volume grows" path. The error-budget math is a pure `sloPolicy` module so the
  thresholds are one-file tunable.
- **Content-hash dedupe false-positives** (two legitimately distinct events with identical bodies)
  → Content-hash is a *secondary* guard scoped to `(appKey, topic, contentHash)` within a short
  window; the canonical key stays `shopifyWebhookId`. A genuinely-distinct redelivery carries a
  distinct webhook-id and is not collapsed.
- **Replay re-processing side-effects** → `processWebhookEvent` must stay idempotent (it already
  keys compliance/billing effects off the event); replay resets status + re-enqueues the *same*
  event id, and the audit (`webhook.replayed`) makes every manual replay traceable.
- **Break-glass friction blocks urgent support** → Non-sensitive scopes self-activate instantly
  (reason required, no approval wait); only *sensitive* scopes/targets require approval. TTL is
  generous-by-default and configurable; grants are per-actor so one person's expiry never blocks
  another.
- **Standing-`pii:view`-callers break when the grant gate lands** → The reveal path now needs an
  active grant, so the UI must *request* a grant (reason prompt) before revealing — a behavior
  change for SUPPORT. Mitigate by making the request+activate a single in-flow step for
  non-sensitive scopes (one reason prompt, same as today's reveal), so the UX delta is "your
  reveal is now time-boxed", not "two-step approval".
- **Health probe lies** (process up but a worker is wedged) → `/readyz` checks DB + Redis
  reachability (the dependencies that actually gate request serving); worker liveness is a
  *separate* signal on the monitoring tile (last-completed-job timestamp per queue), not folded
  into `/readyz`, so a wedged worker degrades a tile/alert rather than pulling the web instance
  out of rotation.
- **Scope creep toward a full observability platform** → Hard non-goals above; we expose a
  `/metrics` endpoint + persist trend KPIs + author a policy. Grafana/OTel/pager/status-page are
  bought or "Later".

## Migration Plan

1. Land the single additive Prisma migration (`BreakGlassGrant` + 2 enums; `WebhookEvent`
   columns; `WebhookStatus.DEAD_LETTER`) via `migrate-dev`; regenerate the client; confirm
   `check-no-app-db-writes.mjs` green.
2. Ship the webhook-reliability changes (content-hash + attempts + dead-letter + replay) — pure
   enhancement of an existing path; existing events keep flowing.
3. Ship `opsMetricsService` + `/metrics` + `/healthz`/`/readyz` + the `ops-rollup` worker; start +
   schedule it in [server/start.js](../../../server/start.js) beside the KPI/compliance/SLA sweeps
   (`startOpsRollupWorker()` + `scheduleOpsRollup("saleswitch")`). Wire the monitoring Tremor route.
4. Ship `sloPolicy` + `sloService` evaluation inside the ops tick; emit alerts via `captureError`;
   author `docs/slo-policy.md`. Point the bought pager at the Sentry project + `/metrics`.
5. Ship `breakGlassService` + the grant gate on `revealPii`/`impersonate` + the request/approve UI;
   add `ops:view`/`impersonate` abilities. Wire the bought status page to `/healthz` + the
   synthetics; author `docs/status-page.md`.
6. **Rollback:** code revert is safe — all columns are nullable/defaulted and the new model is
   unreferenced by existing data; reverting drops the grant gate (PII reveal returns to standing
   `pii:view`), stops the ops rollup, and the dead-letter/replay paths simply go unused. No data
   loss, no broken reads.

## Open Questions

1. **BullMQ Prometheus API** — confirm the installed BullMQ version exposes
   `exportPrometheusMetrics()` (vs. composing the payload from `getJobCounts()`); pick one in the
   first task. (Roadmap §2.1 asserts it ships natively — verify on the pinned version.)
2. **SLO objectives + windows** — confirm the first SLOs (webhook-delivery %, request
   availability), their objectives (99.9%? 99.5%?), and whether to start with full MWMBR or the
   simpler long-window rule given current traffic.
3. **Pager + status-page vendors** — pick the on-call/paging vendor (§2.2) and the status-page
   vendor (§2.3); both are config/secrets, not code, but the choice gates `docs/*` + the alert
   routing.
4. **Break-glass approval policy** — confirm which scopes/targets count as *sensitive* (require
   ADMIN approval) vs. self-activating, the default TTL, and whether SUPPORT can request
   `IMPERSONATION` at all (proposed: ADMIN-only).
5. **`/metrics` auth** — confirm a static `METRICS_AUTH_TOKEN` bearer is acceptable given the
   zero-trust gateway already fronts the app (proposed) vs. mTLS / an allow-listed scraper IP.
6. **Synthetic run cadence + environment** — confirm where synthetics run (the bought monitor vs.
   a CI cron) and against which environment (prod vs. a staging mirror), and the alert cadence in
   `docs/status-page.md`.
