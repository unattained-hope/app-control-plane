# Design: add-usage-analytics-p3-rollups

## Context

The control plane's KPI pattern is settled: BullMQ workers pre-aggregate into snapshot rows; dashboards read snapshots only (lint/test-enforced invariant). Existing precedents: `kpiRollup` (connector KPIs → `KpiSnapshot`), `growthRollup` (health/NPS/churn → `MerchantHealthSnapshot`). Phase 2 delivers a mirrored `UsageEvent` table in the control plane's own DB. This phase turns raw events into the dimensioned time series and cohort labels that Phase 4 renders.

## Goals / Non-Goals

**Goals:**
- Deterministic, idempotent daily metrics: re-running a rollup for a day yields identical rows (upsert on the compound key).
- Same-day freshness without recomputing history (hourly incremental for today; daily finalization for yesterday).
- Cohort labels that make every dashboard sliceable and feed churn-save workflows.
- Tunable scoring/thresholds in config — product judgment lives in one reviewed place, not scattered constants.

**Non-Goals:**
- No UI (Phase 4). No alerts/digests (Phase 5).
- No general ad-hoc query engine — the metric catalog is explicit; new questions become new rollup metrics.
- No per-event streaming aggregation; batch cadence is sufficient at this volume.

## Decisions

1. **New `UsageMetricDaily` table instead of shoehorning into `KpiSnapshot`.** Funnels/adoption/action-counts are (metric, dimension) series; encoding dimensions into metric-name strings ages badly and defeats indexing. `KpiSnapshot` still receives the headline scalars (WAU/MAU/events-per-day) so existing tiles work unchanged. Alternative — extend `KpiSnapshot` with a dimension column (rejected: touches a shipped model consumed by existing views; a parallel table is additive and risk-free).
2. **Upsert-by-key idempotency.** Every rollup writes via upsert on `(appKey, date, metric, dimension)`; a re-run after a partial failure self-heals. Late-arriving events (ingestion lag) are covered because finalization runs against the mirror the morning after, and any backfilled day can be recomputed by passing an explicit date range.
3. **UTC day grain.** All dates are UTC; timezone nuance belongs to display, not storage. Weekly retention cohorts key on ISO week of `app_installed`.
4. **Funnel/adoption computed from events, not state.** e.g. "wizard started" = distinct shops with `wizard_started` in window; "activated" = `campaign_activated` present. Keeps metrics consistent with what was actually observed and immune to later state mutations.
5. **Cohort assignment as a separate nightly job writing point-in-time snapshots.** History of movement between segments is itself a product signal (e.g. ENGAGED→DORMANT flow). Rules: lifecycle from install/activation/recency facts; intensity from a weighted 30-day score (campaigns activated ×5, wizard sessions ×2, template edits ×1, active days ×1) bucketed by percentile; personas from explicit rule thresholds (e.g. AUTOMATION_USER = recurrence or Flow ≥2 uses). Weights/thresholds in config like health-score weights.
6. **Impersonation excluded at the query boundary.** Every rollup query filters `impersonated = false` — one shared predicate helper so it cannot be forgotten per-metric.
7. **Median step dwell via percentile aggregation in SQL** over `wizard_step_saved.durationMs`, stored as its own metric (dimension = step). No client-side math.

## Risks / Trade-offs

- [Metric definitions drift from intuition (e.g. what counts as "active")] → definitions written into the spec + a metric-catalog doc; each metric has a test with a hand-computed fixture.
- [Ingestion lag skews today's incremental numbers] → today is labeled provisional in Phase 4 UI; finalization pass corrects yesterday.
- [Cohort thresholds arbitrary at first] → config-tunable; snapshots keep history so re-bucketing is comparable over time.
- [Rollup runtime growth] → incremental by day + mirror indexes; if the portfolio 10×s, per-metric materialization can move to ClickHouse per the roadmap's "Later" tier without changing readers.

## Migration Plan

Additive migration. Backfill: run the daily rollup over the mirror's full history once on deploy (bounded — mirror starts at Phase 2 go-live). Rollback: disable jobs; tables remain.

## Open Questions

- Initial intensity percentile cut-points (e.g. POWER = top 10%?) — ship with defaults, revisit after two weeks of real data.
