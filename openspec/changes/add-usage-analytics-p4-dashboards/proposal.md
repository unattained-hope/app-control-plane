# Proposal: add-usage-analytics-p4-dashboards

> Phase 4 of the usage-analytics plan (`badgy/docs/research/usage-analytics-2026/index.html`).
> Depends on `add-usage-analytics-p3-rollups` (metric + cohort tables) and, for the activity feed, `add-usage-analytics-p2-ingestion` (mirror table).

## Why

Phases 1–3 produce the data; this phase makes it visible and decision-ready. The team needs to see usage patterns — which features earn their keep, where the wizard loses merchants, which shops are drifting dormant — inside the control plane where merchant context (plan, health, support history) already lives.

## What Changes

- New tRPC `usage` router (all procedures behind `requireAbility("view")`), reading `UsageMetricDaily`, `UsageCohortSnapshot`, and `KpiSnapshot` only — plus one bounded, paginated raw-event read for the per-merchant activity feed (control plane's own mirror, permitted by the invariant, which forbids app-DB reads and unaggregated dashboard charts, not paginated feeds from our own DB).
- Four new shell pages + one tab:
  - `/usage` — overview: stat tiles (WAU, MAU, stickiness DAU/MAU, events/day, median time-to-first-campaign), active-shops trend (Tremor LineChart), top-actions BarList, activation funnel.
  - `/usage/features` — adoption bars per feature (30/90-day toggle), per-feature trend lines, discount-type and campaign-type mix (DonutChart).
  - `/usage/funnel` — wizard step conversion, median dwell per step, top validation-failure rules, sliceable by plan and cohort.
  - `/usage/shops` — shop explorer: ScatterChart dot plot (switchable axes: tenure, activity score, campaigns activated; color = plan or lifecycle) over a TanStack cohort table with filters, linking to merchant detail.
  - Merchant detail → new **Activity** tab: recent event stream for that shop (paginated, impersonated events visibly badged).
- Every view shows "as of" timestamps (house rule) and marks the current day's numbers provisional.
- Nav entries in the shell layout, gated like existing modules via the app registry's `enabledModules`.

## Capabilities

### New Capabilities
- `usage-dashboards`: the five views, their data sources (snapshots only for charts), slicing, RBAC, and freshness-labeling requirements.

### Modified Capabilities
<!-- none — existing dashboard (cp-kpi-dashboard) unchanged; new headline tiles read KpiSnapshot rows that Phase 3 already writes -->

## Impact

- **App:** ~5 route modules under the shell, first substantial use of Tremor's Line/Donut/Scatter charts (already installed); shared chart wrappers for empty/loading/"as of" states.
- **Server:** one tRPC router + thin read services; no new workers, no schema changes.
- **RBAC:** VIEWER-and-up read access, consistent with existing dashboard; no write procedures.
- **Perf:** all chart queries hit compound-key metric rows; activity feed is cursor-paginated with a hard page cap.
