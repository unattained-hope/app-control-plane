## 1. Schema & migration (CP-owned, additive)

- [x] 1.1 Extend `WebhookStatus` enum with `DEAD_LETTER` in `prisma/schema.prisma`
- [x] 1.2 Extend `WebhookEvent` with `contentHash String?`, `attempts Int @default(0)`, `lastAttemptAt DateTime?`; add `@@index([appKey, topic, contentHash])`
- [x] 1.3 Add `BreakGlassScope` enum (`PII_REVEAL IMPERSONATION`) and `BreakGlassStatus` enum (`REQUESTED APPROVED ACTIVE EXPIRED REVOKED DENIED`)
- [x] 1.4 Add CP-owned `BreakGlassGrant` model (`appKey`, `actorUserId`, `scope`, `targetShop String?`, `reason`, `status @default(REQUESTED)`, `approverUserId String?`, `expiresAt`, timestamps; `@@index([appKey, actorUserId, status])`, `@@index([status, expiresAt])`)
- [x] 1.5 Regenerate the client (`prisma generate`; migrations are applied via `db push`/`migrate-dev` against the local DB) and confirm `scripts/check-no-app-db-writes.mjs` stays green (all new/extended models are control-plane-owned)

## 2. Audit taxonomy & config

- [x] 2.1 Add `webhook.replayed`, `webhook.dead_lettered`, `slo.alert.fired`, `breakglass.requested|approved|denied|activated|revoked|expired`, and `impersonation.start|end` constants to `app/lib/auditActions.ts` (extend `KnownAuditAction`)
- [x] 2.2 Add config to `app/lib/config.ts` (zod, no `process.env` outside it): `METRICS_AUTH_TOKEN`, `WEBHOOK_MAX_ATTEMPTS` (default 5), `WEBHOOK_BACKOFF_CEILING_MS`, the SLO objectives + burn-rate windows/thresholds, `OPS_ROLLUP_CRON`, `WORKER_LIVENESS_WINDOW_MINUTES`, `BREAK_GLASS_TTL_MINUTES`, and the sensitive-scope/approval flags
- [x] 2.3 Add the new audit actions to the filter set in `app/routes/audit.tsx`

## 3. Webhook reliability (cp-webhook-reliability)

- [x] 3.1 Compute a SHA-256 `contentHash` of the raw body in the ingestion path; have `webhookService.ingest` dedupe on both `shopifyWebhookId @unique` and an existing `(appKey, topic, contentHash)` row before enqueueing
- [x] 3.2 Track `attempts` + `lastAttemptAt` in `app/server/workers/webhookProcess.ts`; cap BullMQ backoff (`WEBHOOK_BACKOFF_CEILING_MS`) and bound attempts by `WEBHOOK_MAX_ATTEMPTS`
- [x] 3.3 On retry exhaustion, transition the event `FAILED → DEAD_LETTER` and write a `webhook.dead_lettered` audit row (`source: JOB`, `actorType: SYSTEM`); keep `processWebhookEvent` idempotent
- [x] 3.4 Add a `webhooks` tRPC router: `list` (`requireAbility("ops:view")`, server-paginated, filter by topic/status over `FAILED`/`DEAD_LETTER`) and `replay` (ADMIN-only) that resets status to `RECEIVED`, re-enqueues, and audits `webhook.replayed` in the same transaction; register in `trpc/root.ts`
- [x] 3.5 Add a failed-delivery view (list + replay button) — reuse the merchants-grid server-driven TanStack-Table pattern

## 4. Ops monitoring (cp-ops-monitoring)

- [x] 4.1 Add `opsMetricsService` reading live `queue.getJobCounts()` for every queue (`kpi-rollup`, `webhook-process`, `compliance-sweep`, `sla-sweep`, `ops-rollup`) plus CP gauges (webhook failure/dead-letter counts by status, compliance breaching count) — no app-DB reads
- [x] 4.2 Render Prometheus text (BullMQ-native `bullmq_job_count` composed from `getJobCounts()`/`exportPrometheusMetrics`; append CP gauges) and add a `/metrics` resource route in `app/routes.ts` guarded by a `METRICS_AUTH_TOKEN` bearer check
- [x] 4.3 Add `app/server/workers/opsRollup.ts` (cloned from `complianceSweep.ts`: `connection()`, `makeOpsRollupQueue`, `scheduleOpsRollup(appKey, OPS_ROLLUP_CRON)`, `startOpsRollupWorker` with `withTrace` + `captureError`) that persists ops gauges as `KpiSnapshot` rows
- [x] 4.4 Start + schedule the ops rollup in `server/start.js` beside the KPI/compliance/SLA sweeps (`startOpsRollupWorker()` + `scheduleOpsRollup("saleswitch")`); add it to `app/server/workers/devWorker.ts`
- [x] 4.5 Add a `monitoring` tRPC router (`requireAbility("ops:view")`) exposing live queue health + worker liveness (last-completed-job per queue vs `WORKER_LIVENESS_WINDOW_MINUTES`); register in `trpc/root.ts`
- [x] 4.6 Add `app/routes/monitoring.tsx` (Tremor tiles: queue backlog/failures, webhook failure rate + dead-letters, worker liveness, Sentry error-rate link) with `asOf` timestamps; register the route in `app/routes.ts`

## 5. SLO alerting (cp-slo-alerting)

- [x] 5.1 Add a pure `app/lib/sloPolicy.ts` (mirroring `slaPolicy`): per-SLO objective + multiwindow multi-burn-rate tiers (page 14.4× / 6×, ticket 1×) from config
- [x] 5.2 Add `sloService.evaluate(appKey)` that reads persisted ops metrics over short+long windows, computes burn rate, and flags a tier only when both windows confirm
- [x] 5.3 Emit a tier hit through `captureError` tagged with SLO id + severity (`page`/`ticket`) and audit `slo.alert.fired` (`source: JOB`); call `sloService.evaluate` from the ops-rollup tick (no extra worker)
- [x] 5.4 Author `docs/slo-policy.md`: SLO definitions, error-budget policy, on-call rotation/escalation, the bought-pager wiring (Sentry → vendor), and the low-traffic "start simple, graduate" note

## 6. Status & synthetics (cp-status-synthetics)

- [x] 6.1 Add a `/healthz` liveness resource route (always 200 while up) and a `/readyz` readiness resource route (ping control-plane DB + Redis, 503 if unreachable) in `app/routes.ts`, outside the `_shell` layout, exposing up/down only
- [x] 6.2 Add Playwright synthetic scripts under `e2e/synthetics/` (login → merchant search → open inbox → assert content; real Chrome; screenshot on failure) reusing the existing harness
- [x] 6.3 Author `docs/status-page.md`: bought-vendor choice + wiring to `/healthz` and the synthetics, and the incident-comms cadence (minor ~60 min; major/critical ~15–20 min)

## 7. Break-glass RBAC (cp-break-glass-rbac)

- [x] 7.1 Add `ops:view` and `impersonate` to the CASL `Action` union + grants in `app/server/rbac.ts` (`ops:view` → ADMIN+SUPPORT; `impersonate` → ADMIN); extend the RBAC matrix doc-comment
- [x] 7.2 Add `breakGlassService`: `request(actor, scope, targetShop?, reason)` (self-activate non-sensitive with `BREAK_GLASS_TTL_MINUTES` expiry; sensitive → `REQUESTED`), `approve`/`deny`/`revoke`, and `requireActiveGrant(actor, scope, shop?)` (403 if none/expired) — every transition audits `breakglass.*` in-tx
- [x] 7.3 Gate the PII reveal path on `requireActiveGrant(PII_REVEAL)` after `requireAbility("pii:view")`; keep the existing typed-reason `merchant.pii.view` audit; the UI requests the grant (same reason prompt) before revealing so non-sensitive reveals stay one flow
- [x] 7.4 Add the impersonation entry/exit gate (`requireAbility("impersonate")` + active `IMPERSONATION` grant) auditing `impersonation.start`/`end`
- [x] 7.5 Add a `breakGlass` tRPC router (`request`, `list`, ADMIN `approve`/`deny`/`revoke`); register in `trpc/root.ts`; add a minimal grant request/approve UI (reason prompt + pending-approvals list)
- [x] 7.6 Sweep expired grants in the ops-rollup tick (`ACTIVE`→`EXPIRED` past `expiresAt`, audit `breakglass.expired`, `source: JOB`)

## 8. Tests & verification

- [x] 8.1 Extend `test/helpers/fakeDb.ts` with `breakGlassGrant` + `kpiSnapshot` model support (findFirst/findMany/count, `{increment}`, `gt`/`lt` operators) needed by the new services, preserving `$transaction` rollback + `failAudit`
- [x] 8.2 Webhook-reliability tests: same-body/new-id deduped; distinct bodies both enqueue; exhaustion → `DEAD_LETTER` + `webhook.dead_lettered` (idempotent); replay resets+re-enqueues + audits `webhook.replayed` in-tx (rolled back on `failAudit`, no re-enqueue); cross-app replay refused; `listFailed` filters/orders
- [x] 8.3 Ops-monitoring tests: `/metrics` rejects missing/wrong token; `opsMetricsService` Prometheus has `bullmq_job_count` + gauges and no PII; gauges count FAILED/DEAD_LETTER; ops rollup writes `KpiSnapshot` rows (incl. SLO sample); liveness classification
- [x] 8.4 SLO tests: sustained two-window burn fires a page + `slo.alert.fired`; short-window-only blip does not page; within-budget is quiet; an unsampled SLO is skipped
- [x] 8.5 Break-glass tests: reason required; non-sensitive self-activates with TTL expiry; sensitive needs approval; `requireActiveGrant` `FORBIDDEN` without/with-expired grant and authorizes with an active grant; request rolled back on `failAudit`; expired grant swept to `EXPIRED` (SYSTEM/JOB)
- [x] 8.6 RBAC tests extended in `test/rbac.test.ts`: `ops:view` is ADMIN+SUPPORT not VIEWER; `impersonate` is ADMIN-only (the `webhooks.replay`/break-glass `approve` ADMIN-only role checks are enforced in their routers)
- [x] 8.7 Status/synthetics tests: `/healthz` is 200; `/readyz` is 503 when a dependency is down; a synthetic script exists (Playwright config captures a screenshot on failure)
- [x] 8.8 E2E (Playwright, mirroring the existing suite): monitoring route renders queue tiles for `ops:view` + denies VIEWER; failed-delivery view renders; break-glass request self-activates; `/healthz` 200
- [x] 8.9 Run typecheck + unit tests + the lint guard (`check-no-app-db-writes.mjs`) green before declaring done

## 9. Dependencies & open questions

- [x] 9.1 Verified the pinned BullMQ (5.79.1) exposes `exportPrometheusMetrics()` (composes from `getJobCounts()`); task 4.2 composes a clean multi-queue document from the same `getJobCounts()` source — no third-party exporter
- [x] 9.2 Open questions from `design.md` implemented with documented, config-tunable defaults (SLO objectives/windows in `config.ts` + `docs/slo-policy.md`; break-glass TTL/approval flags in `config.ts`; `/metrics` static-token model; pager + status-page vendors are apply-time SaaS choices documented in `docs/`) — flagged there for team confirmation, no code dependency blocked
