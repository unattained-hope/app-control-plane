# usage-metric-rollups

## ADDED Requirements

### Requirement: Dimensioned daily metric store
The system SHALL store computed usage metrics in a `UsageMetricDaily` model keyed uniquely by `(appKey, date, metric, dimension)` with a float value, where `dimension` defaults to an empty string for scalar metrics. Writes SHALL use `upsert` on that compound key (not append-only `createMany`), so recomputation overwrites rather than duplicates. Headline scalars (weekly active shops, monthly active shops, events per day) SHALL additionally be written to `KpiSnapshot` under `usage.*` metric names (via the shipped append-only snapshot path).

#### Scenario: Idempotent recomputation
- **WHEN** the rollup for a given day runs twice
- **THEN** the `UsageMetricDaily` rows for that day are identical after each run, with no duplicates (each upserted in place on its compound key)

### Requirement: Activity metrics
The rollup SHALL compute per app and UTC day: distinct active shops (daily, trailing-7-day, trailing-30-day), total events, and per-event-name action counts (dimension = event name). All usage metrics SHALL exclude events flagged `impersonated` via a shared query predicate.

#### Scenario: Support activity excluded
- **WHEN** a support agent performs actions via impersonation on a given day
- **THEN** that shop is not counted active and those events appear in no metric for that day

### Requirement: Wizard funnel metrics
The rollup SHALL compute, per day and per funnel stage (dimension = stage), the number of distinct shops reaching: wizard started (`wizard_started`), each step saved (`wizard_step_saved` with `properties.step` ∈ basics, discount, selector, theme, labels), and wizard completed (`wizard_completed`); plus counts of the top validation-failure rules (from `wizard_validation_failed` with `properties.rules`, dimension = rule id). Median step dwell time is OUT OF SCOPE for this change: the shipped `wizard_step_saved` event carries only `{ step }`, no `durationMs`. Dwell is added once Badgy's Phase-5 client dwell beacon emits a duration; this rollup SHALL be structured so a `usage.funnel.dwell` metric can be added without reworking the existing metrics.

#### Scenario: Funnel stage counting
- **WHEN** a shop saves the discount step three times in one day
- **THEN** it counts once toward that day's discount-stage shop count

#### Scenario: Dwell deferred, not faked
- **WHEN** the funnel rollup runs against shipped Phase-1 events
- **THEN** no median-dwell metric is written (the source duration does not exist), and the rollup does not error on its absence

### Requirement: Feature adoption metrics
The rollup SHALL compute, per feature (dimension = feature: badges, banner, countdown, topbar, recurrence, discount codes, markets sync, flow, and future additions), the count of distinct shops that used the feature within trailing 30-day and 90-day windows, and the count of active shops in the same window as the denominators.

#### Scenario: Adoption ratio derivable
- **WHEN** Phase 4 renders adoption percentages
- **THEN** numerator and denominator metrics exist for the same window without querying raw events

### Requirement: Retention cohort metrics
The rollup SHALL compute weekly install-cohort retention: for each ISO install week (from `app_installed` events) and each subsequent week offset N, the count of cohort shops active in week N (dimension = `cohortWeek:weekN`).

#### Scenario: Cohort matrix
- **WHEN** the dashboard requests retention for the last 12 install cohorts
- **THEN** the full matrix is readable from metric rows alone

### Requirement: Incremental freshness and finalization
An hourly job SHALL update the current UTC day's metrics incrementally; a daily job SHALL finalize the previous day (recomputing it fully against the mirror, correcting for ingestion lag). A manual backfill entry point SHALL recompute an arbitrary date range.

#### Scenario: Late-arriving events
- **WHEN** events for yesterday arrive after midnight due to ingestion lag
- **THEN** the finalization pass includes them in yesterday's final numbers
