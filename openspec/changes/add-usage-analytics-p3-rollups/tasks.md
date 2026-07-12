# Tasks: add-usage-analytics-p3-rollups

> **Blocked** until `add-usage-analytics-p2-ingestion` ships (this rollup reads the CP mirror table).

## 1. Schema & config

- [x] 1.1 Add `UsageMetricDaily` (`id cuid`, leading `appKey`, `date DateTime @db.Date`, `metric String`, `dimension String @default("")`, `value Float`, `@@unique([appKey, date, metric, dimension])`, `@@map("usage_metric_daily")`, `///` doc) and `UsageCohortSnapshot` (`id cuid`, `appKey`, `shop String` — matching the `MerchantHealthSnapshot` field name, not `shopDomain` — `lifecycle String`, `intensity String`, `personaTags String[]`, `activityScore Float`, `computedAt DateTime`, `@@index([appKey, lifecycle, computedAt])`, `@@map("usage_cohort_snapshots")`) models; create migration
- [x] 1.2 Add config to the zod `EnvSchema`: `USAGE_ROLLUP_INCREMENTAL_CRON`, `USAGE_ROLLUP_FINALIZE_CRON`, `USAGE_COHORT_CRON` (`z.string().default(...)`, following `GROWTH_ROLLUP_CRON`); intensity weights + percentile cut-points + persona thresholds (`z.coerce.number()...`, following the shipped `HEALTH_WEIGHT_*` pattern)
- [x] 1.3 Document the metric catalog (name, dimension, definition, window, which shipped event `name` value it derives from) in `docs/usage-metrics.md`

## 2. Rollup service & workers

- [x] 2.1 Create `usageRollupService` with a shared `impersonated = false` predicate helper and an `upsert`-by-compound-key writer (NOT `createMany` — divergence from `kpiService.ts` is intentional and idempotent)
- [x] 2.2 Implement activity metrics (distinct-`shopDomain` DAU/WAU/MAU, events total, per-`name` action counts) + append headline scalars into `KpiSnapshot` under `usage.*` via the shipped `createMany` path
- [x] 2.3 Implement wizard funnel metrics: stage shop-counts (`wizard_started`/`wizard_step_saved`.`properties.step`/`wizard_completed`) + top validation rules (`wizard_validation_failed`.`properties.rules`). Do NOT implement median dwell (source `durationMs` not emitted — see spec); leave a clean seam for a future `usage.funnel.dwell` metric
- [x] 2.4 Implement feature adoption metrics (30/90-day distinct-shop numerators + active-shop denominators) from the shipped feature/campaign event names
- [x] 2.5 Implement weekly retention cohort matrix from `app_installed` + activity
- [x] 2.6 Register `usageRollup` workers (hourly incremental / daily finalize) with a manual date-range backfill entry point, in BOTH `app/server/workers/devWorker.ts` and `server/start.js`; `withTrace`/`captureError` instrumentation

## 3. Cohort assignment

- [x] 3.1 Create `usageCohortService`: lifecycle precedence rules, weighted intensity score + percentile bucketing, persona rule evaluation (all thresholds from config)
- [x] 3.2 Register nightly cohort worker (two-site) writing append-only `UsageCohortSnapshot` rows
- [x] 3.3 Unit tests with hand-computed fixtures: each lifecycle boundary (6/7-day NEW edge, dormancy at 30 d, churned), intensity weighting, multi-persona assignment, impersonation exclusion

## 4. Metric correctness tests

- [x] 4.1 Fixture-based tests per metric family: seeded mirror events → expected metric rows (activity, funnel dedupe-per-day, adoption windows, retention matrix)
- [x] 4.2 Idempotency test: double-run produces identical rows; finalization corrects a late-arriving-event fixture

## 5. Verification

- [x] 5.1 Typecheck, lint, full suite green; invariant tests (dashboards-read-snapshots) untouched
- [x] 5.2 Backfill run over local mirrored data; spot-check WAU and one funnel stage against a manual SQL count
