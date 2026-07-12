# Usage-metric catalog (usage-analytics Phase 3)

> Phase 3 turns the mirrored `UsageEvent` stream (Phase 2b) into the dimensioned daily
> time series and per-shop cohort labels that Phase 4 dashboards render. **Dashboards
> read these pre-aggregated rows only — never raw events** (the standing control-plane
> invariant). This file is the source of truth for what each metric means.

Computed by `usageRollupService` (metrics) and `usageCohortService` (cohorts), driven
by the `usage-rollup` worker. Every value derives from the CP-owned mirror table with
**impersonated events excluded** at the query boundary (the shared `NOT_IMPERSONATED`
predicate in `app/lib/usageMetrics.ts`).

## Grain & storage

- **Metrics** land in `UsageMetricDaily(appKey, date, metric, dimension, value)`,
  unique on `(appKey, date, metric, dimension)`. `date` is a **UTC day** (`@db.Date`).
  `dimension` is `""` for scalar metrics, otherwise the series key. Writes use **upsert**
  on the compound key, so recomputing a day overwrites in place — a re-run is idempotent
  (deliberately unlike `KpiSnapshot`'s append-only `createMany`).
- **Headline scalars** (WAU / MAU / events-per-day) are **also** appended to `KpiSnapshot`
  under `usage.*` metric names via the shipped append-only path, so existing dashboard
  tiles pick them up unchanged.
- **Cohorts** land in `UsageCohortSnapshot(appKey, shop, lifecycle, intensity,`
  `personaTags[], activityScore, computedAt)`, **append-only per run** so the history of
  segment movement is preserved. (`shop`, not `shopDomain`, for consistency with the
  snapshot family; the job joins the mirror on the domain value.)

## Cadence

| Job | Cron (config) | What it computes |
|---|---|---|
| `incremental` | `USAGE_ROLLUP_INCREMENTAL_CRON` (hourly) | **Today** (UTC) — same-day freshness; provisional |
| `finalize` | `USAGE_ROLLUP_FINALIZE_CRON` (00:30 UTC) | **Yesterday**, recomputed fully (corrects ingestion lag) + retention matrix |
| `cohort` | `USAGE_COHORT_CRON` (02:00 UTC) | Nightly per-shop cohort snapshot |
| `backfill` | manual (`enqueueUsageRollupBackfill`) | An arbitrary inclusive UTC-day range + retention (seed history on deploy) |

## Metric reference

`metric` values are the constants in `app/lib/usageMetrics.ts` (`UsageMetric`).

### Activity

| Metric | Dimension | Definition | Window | Derived from |
|---|---|---|---|---|
| `usage.active.dau` | `""` | Distinct active shops on the day | day | any event |
| `usage.active.wau` | `""` | Distinct active shops, trailing 7 days incl. day | 7d | any event |
| `usage.active.mau` | `""` | Distinct active shops, trailing 30 days incl. day | 30d | any event |
| `usage.events.total` | `""` | Total events on the day | day | any event |
| `usage.action.count` | event `name` | Count of that event on the day | day | each `UsageEventName` value present |

`usage.active.wau`, `usage.active.mau`, and `usage.events.total` are mirrored into
`KpiSnapshot` as `usage.active.wau`, `usage.active.mau`, and `usage.events.per_day`.

### Wizard funnel

Stage counts are **distinct shops reaching the stage on the day** — a shop that saves the
same step several times counts **once** for that stage/day.

| Metric | Dimension | Definition | Derived from |
|---|---|---|---|
| `usage.funnel.stage` | `started` | Distinct shops that started the wizard | `wizard_started` |
| `usage.funnel.stage` | `basics` `selector` `discount` `labels` `theme` | Distinct shops that saved that step | `wizard_step_saved`.`properties.step` |
| `usage.funnel.stage` | `completed` | Distinct shops that completed the wizard | `wizard_completed` |
| `usage.funnel.validation_rule` | rule id | Occurrences of the failing rule (top N/day) | `wizard_validation_failed`.`properties.rules[]` |

**Median step dwell is intentionally NOT produced.** The shipped `wizard_step_saved`
event carries only `{ step }` — no `durationMs` (verified against Badgy's
`dispatchWizardAction.ts`). A `usage.funnel.dwell` metric (dimension = step) is reserved
for after Badgy's Phase-5 client dwell beacon lands; `rollupDay` has a documented seam so
it can be added without reworking the other metrics. The rollup does **not** error on the
duration's absence.

### Feature adoption

Numerators are **distinct shops that used the feature in the window**; the matching
denominator is distinct active shops in the same window, so Phase 4 divides without
touching raw events.

| Metric | Dimension | Definition | Window |
|---|---|---|---|
| `usage.adoption.d30` / `usage.adoption.d90` | feature | Distinct shops using the feature | 30d / 90d |
| `usage.active_shops.d30` / `usage.active_shops.d90` | `""` | Distinct active shops (denominator) | 30d / 90d |

**Feature → event names** (`FEATURE_EVENT_NAMES`):

| Feature | Events |
|---|---|
| `badges` | `badge_template_{created,edited,duplicated,deleted}` |
| `banner` | `banner_template_{created,edited,duplicated,deleted}` |
| `recurrence` | `campaign_recurrence_stopped` (only shipped recurrence signal) |
| `flow` | `flow_action_invoked` |
| `offers` | `offer_link_minted` |
| `discount_codes` | `campaign_activated` (proxy; refined in a later phase) |
| `markets_sync` | `setting_saved` with `properties.key = "markets_sync"` |

> Note on `recurrence` / `discount_codes`: the shipped event set has no dedicated
> "recurrence used" or "discount-code campaign activated" event, so these use the closest
> available signal. They are honest approximations, flagged here so a later phase can
> tighten them once Badgy emits a more specific event.

### Retention

Weekly install-cohort matrix. Rows are keyed by `date` = the cohort's **week-0 Monday**
(UTC ISO week of the shop's first `app_installed`).

| Metric | Dimension | Definition |
|---|---|---|
| `usage.retention.cohort_size` | `""` | Number of shops installed in that ISO week |
| `usage.retention.cohort` | `cohortWeek:weekN` | Cohort shops active in week offset N (0 = install week) |

Spans the trailing `USAGE_RETENTION_MAX_WEEKS` install cohorts; for each cohort, offsets
`0..min(observable, MAX_WEEKS-1)` are written.

## Cohort labels

Assigned nightly per shop from behavioral facts (all thresholds/weights are config).

### Lifecycle (`assignLifecycle`, deterministic precedence)

`CHURNED` (uninstalled) → `NEW` (installed < 7 days) → `ONBOARDING` (never activated) →
`ACTIVATED` (first activation within its first 30 days) → `ENGAGED` (any event in
trailing 30 days) → `DORMANT` (installed, silent 30 days).

### Intensity (`intensityScore` + `intensityBand`)

30-day weighted score: `campaigns_activated ×5 + wizard_sessions ×2 + template_edits ×1 +
active_days ×1` (weights: `USAGE_INTENSITY_WEIGHT_*`). Bucketed by percentile of the
day's non-zero population: at/above `USAGE_INTENSITY_PERCENTILE_POWER` → **POWER**,
at/above `USAGE_INTENSITY_PERCENTILE_REGULAR` → **REGULAR**, else **LIGHT**; a zero score
is **INACTIVE**.

### Personas (`assignPersonas`, zero or more)

| Tag | Rule (config) |
|---|---|
| `DISCOUNT_ORCHESTRATOR` | campaigns activated ≥ `USAGE_PERSONA_DISCOUNT_ORCHESTRATOR_MIN` |
| `BADGE_DESIGNER` | badge template events ≥ `USAGE_PERSONA_BADGE_DESIGNER_MIN` |
| `BANNER_BROADCASTER` | banner template events ≥ `USAGE_PERSONA_BANNER_BROADCASTER_MIN` |
| `AUTOMATION_USER` | recurrence **or** Flow events ≥ `USAGE_PERSONA_AUTOMATION_USER_MIN` |
| `MULTI_MARKET` | markets-sync enabled (`setting_saved` key `markets_sync`) |
| `MINIMALIST` | active with ≤ `USAGE_PERSONA_MINIMALIST_MAX_FEATURES` distinct features |

## Governance

- New questions become **new rollup metrics** here — there is no ad-hoc query engine.
- Never inline an event-name string; add it to `Ev` in `app/lib/usageMetrics.ts` mirroring
  Badgy's `UsageEventName` value (renames there are additive by contract).
- Metric-name renames fragment historical series — treat `UsageMetric` values as stable.
