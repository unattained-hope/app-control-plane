# Proposal: add-usage-analytics-p3-rollups

> Phase 3 of the usage-analytics plan (`badgy/docs/research/usage-analytics-2026/index.html`).
> Depends on `add-usage-analytics-p2-ingestion` (mirror table). Feeds Phase 4 (`add-usage-analytics-p4-dashboards`).

## Why

Raw mirrored events answer nothing by themselves, and the control plane's standing invariant forbids dashboards from querying raw data at render time. This phase computes the numbers the dashboards will show — activity, funnels, adoption, retention — and assigns every shop the cohort labels ("what kind of users are using our app") that make every future view sliceable by segment.

## What Changes

- New `UsageMetricDaily` model: `(appKey, date, metric, dimension, value)` with a unique compound key — deliberately extends the flat `KpiSnapshot` shape with a `dimension` column because funnels, adoption, and per-action counts are dimensioned series.
- New `UsageCohortSnapshot` model: per-shop `(appKey, shop, lifecycle, intensity, personaTags[], activityScore, computedAt)` — same snapshot pattern as the shipped `MerchantHealthSnapshot` (which uses `shop`, `asOf`, `factors Json`, `HealthBand` enum). Note the mirror table uses `shopDomain` while the health/cohort snapshots use `shop`; keep `shop` here for consistency with the existing snapshot family, and join on it.
- New `usageRollup` BullMQ worker (hourly incremental for today, daily finalization):
  - Activity: DAU/WAU/MAU (distinct active shops by `shopDomain`), events total, per-action counts (dimension = event `name` value, e.g. `campaign_activated`), stickiness inputs.
  - Wizard funnel: shops reaching each stage (dimension = stage) + top validation-failure rules (from `wizard_validation_failed.properties.rules`). **Median step dwell is DEFERRED** — the shipped `wizard_step_saved` event carries only `{ step }`, not a `durationMs` (verified against Badgy `dispatchWizardAction.ts`). Computing dwell requires Badgy Phase 5's client dwell beacon (`add-usage-analytics-p5-refinement` task 5.1) to land first; until then the funnel shows stage conversion + validation failures only.
  - Feature adoption: distinct shops using each feature in trailing 30/90 d (dimension = feature), derived from the shipped event names (`badge_template_*`, `banner_template_*`, `flow_action_invoked`, `offer_link_minted`, `setting_saved` with `key: "markets_sync"`, and campaign `properties` like recurrence).
  - Retention: weekly install-cohort activity matrix (dimension = `cohortWeek:weekN`), keyed on `app_installed`.
  - Job outcomes and activation-blocked counts from campaign events (`campaign_activation_blocked`, etc.).
  - All metrics exclude rows where `impersonated = true`.
- Nightly cohort assignment job: lifecycle stage (NEW → ONBOARDING → ACTIVATED → ENGAGED → DORMANT → CHURNED), usage intensity (POWER/REGULAR/LIGHT/INACTIVE by weighted 30-day score percentile), feature personas (rule thresholds over the adoption vector) — weights/thresholds tunable in config, mirroring health-score weights.
- Headline numbers (WAU, MAU, events/day) also written into `KpiSnapshot` so the existing dashboard tiles pick them up unchanged.

## Capabilities

### New Capabilities
- `usage-metric-rollups`: the metric catalog, grain, dimensioning, incremental/finalization semantics, impersonation exclusion, and idempotency of rollup computation.
- `usage-cohort-assignment`: the three cohort axes, assignment rules, snapshot cadence, and configurability.

### Modified Capabilities
<!-- none — KpiSnapshot gains new metric rows (data, not schema); cp-kpi-dashboard requirements unchanged -->

## Impact

- **Prisma:** two new models + migration (control-plane DB only), matching house conventions (`id cuid`, leading `appKey`, `Float` values, `Json` payloads, `@@map` snake_case, `///` doc comment).
- **Server:** new `usageRollupService` + `usageCohortService`; `usageMetricDaily` written via `upsert` on the compound unique key (NOT `createMany` — this deliberately diverges from `kpiService.ts`'s append-only model so a re-run is idempotent); headline scalars ALSO append-written to `KpiSnapshot` under `usage.*` metric names via the shipped `createMany` path. New workers registered in BOTH `app/server/workers/devWorker.ts` AND `server/start.js` (the two-site pattern); two cron knobs (hourly incremental + daily finalize) plus a nightly cohort cron, added to the zod `EnvSchema` following `GROWTH_ROLLUP_CRON`; cohort weights/thresholds follow the shipped `HEALTH_WEIGHT_*` config pattern.
- **Perf:** rollups are incremental by day and bounded by the mirror's indexes; dashboards never touch raw events (invariant preserved).
- **Downstream:** Phase 4 reads `UsageMetricDaily`/`UsageCohortSnapshot` exclusively; at-risk/health views can join cohort labels immediately.

## Dependencies & gaps

- **Blocked on `add-usage-analytics-p2-ingestion`** (the CP mirror table it reads).
- **Median step dwell is not computable from shipped events** — deferred to after the Badgy Phase-5 dwell beacon. This proposal's funnel scope drops dwell; everything else is computable from the events that shipped in Phase 1.
- All event `name`/`category` values and property keys this rollup groups on were cross-checked against Badgy's shipped `shared/enums.ts` and emission code; the only missing property is `durationMs` (above).
