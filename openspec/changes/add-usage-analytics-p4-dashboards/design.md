# Design: add-usage-analytics-p4-dashboards

## Context

The control plane renders under a shell layout with an app selector; the KPI dashboard's data path (`dashboard.tsx` → `trpc.dashboard.kpis` → `KpiService.latest`) is the sanctioned template. Tremor 3.18 and TanStack Table are installed; only a BarList is used so far, so this phase establishes the chart conventions others will copy. Phase 3 provides `UsageMetricDaily` (dimensioned series), `UsageCohortSnapshot` (segments), and headline `KpiSnapshot` rows; Phase 2 provides the mirrored events for the activity feed.

## Goals / Non-Goals

**Goals:**
- Decision-ready views: every chart answers a named product question (which features earn their keep, where the wizard leaks, who is drifting dormant).
- Uniform slicing: plan / lifecycle / persona filters behave identically across views.
- Honest freshness: "as of" stamps everywhere; today's partial numbers visibly provisional.
- Establish reusable chart wrappers (loading/empty/error/"as of") so future viz work is consistent.

**Non-Goals:**
- No ad-hoc query builder or custom chart composer — fixed views over the metric catalog.
- No alerts/digests/saved views (Phase 5).
- No merchant-facing analytics (this is the internal admin).

## Decisions

1. **One `usage` tRPC router with per-view procedures** (`overview`, `features`, `funnel`, `shops`, `activity`) rather than a generic metric-query procedure. Rationale: server-shaped responses keep chart components dumb and the metric catalog private; a generic query surface invites unaggregated misuse. Each procedure composes reads from the metric/cohort tables.
2. **Charts read snapshots; the activity feed is the one raw read.** The invariant exists to protect app primaries and render-time aggregation. A cursor-paginated, hard-capped feed from the control plane's own mirror is neither — documented as such in the router to keep the lint guard's intent clear.
3. **Slice filters resolve to cohort snapshots, not event scans.** Filtering "funnel by persona" means: latest cohort snapshot per shop → shop set → funnel metrics computed per segment in Phase 3 (dimension = segment) where pre-computed, else the filter narrows the shop-count metrics that were rolled up per segment. Segment-sliced metrics that prove hot get promoted to their own rollup dimensions rather than computed live.
4. **Scatter plot payload is per-shop aggregate rows from cohort snapshots** (tenure, activity score, campaigns activated, plan, lifecycle) — one row per shop, bounded by shop count (hundreds), not events. Axis switching is client-side over the same payload.
5. **Provisional-today convention:** the current UTC day renders with a dashed/being-computed treatment and the "as of" stamp of the last rollup run; finalized days render solid. One shared `AsOf` component.
6. **Nav + module gating via the app registry** (`enabledModules` gains `"usage"`), so a second app without usage ingestion simply doesn't show the section — consistent with the multi-app seam.

## Risks / Trade-offs

- [First heavy Tremor usage reveals theming gaps] → build the shared wrapper first against the existing dashboard page's tokens; visual QA in both themes.
- [Slice combinatorics explode rollup dimensions] → start with plan + lifecycle slices pre-rolled; personas filter the shops table only until demand justifies more dimensions.
- [Activity feed tempts future unaggregated charts] → feed procedure returns a capped page shape unsuited to charting; code comment + review rule.
- [Empty states pre-data look broken] → explicit empty-state copy ("collecting data since <date>") in the shared wrapper.

## Migration Plan

Pure additive UI + router. Ship behind the `usage` module flag; enable for SaleSwitch once Phase 3 has ≥1 finalized day. Rollback = disable the module flag.

## Open Questions

- Whether funnel slicing by persona (vs plan/lifecycle) is needed in v1 or can wait for demand — default: wait.
