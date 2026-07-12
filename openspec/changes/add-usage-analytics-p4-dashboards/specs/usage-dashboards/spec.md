# usage-dashboards

## ADDED Requirements

### Requirement: Usage overview page
The system SHALL provide a `/usage` page showing, for the selected app: stat tiles (weekly active shops, monthly active shops, stickiness = DAU/MAU, events per day, median time-to-first-campaign), an active-shops trend line over at least 12 weeks, a ranked list of the most-performed actions, and the activation funnel (installed → theme embed enabled → wizard started → first campaign activated → second campaign within 30 days). All charts SHALL read pre-aggregated metric rows only.

#### Scenario: Overview renders from snapshots
- **WHEN** the overview page loads
- **THEN** every number and chart is served from `UsageMetricDaily` / `KpiSnapshot` / `UsageCohortSnapshot` rows, with no raw-event aggregation at request time

### Requirement: Feature adoption page
The system SHALL provide a `/usage/features` page showing per-feature adoption (distinct shops using each feature over a 30/90-day window toggle, as a percentage of active shops), per-feature trend over time, and the mix of discount types and campaign types among activated campaigns.

#### Scenario: Window toggle
- **WHEN** the user switches from the 30-day to the 90-day window
- **THEN** adoption percentages re-render from the corresponding pre-rolled metrics without recomputation

### Requirement: Wizard funnel page
The system SHALL provide a `/usage/funnel` page showing step-by-step wizard conversion (shops reaching each stage), median dwell time per step, and the most frequent validation-failure rules, sliceable by plan and lifecycle segment.

#### Scenario: Identifying the leak
- **WHEN** a product manager opens the funnel page
- **THEN** the step with the highest drop-off and its top validation failures are readable without further queries

### Requirement: Shop explorer page
The system SHALL provide a `/usage/shops` page with a dot plot of shops (one point per shop; switchable axes among tenure, 30-day activity score, and campaigns activated; color by plan or lifecycle) above a filterable, sortable table of shops with their cohort labels, linking each shop to its merchant detail page. The payload SHALL be one aggregate row per shop derived from cohort snapshots.

#### Scenario: Drill from dot to merchant
- **WHEN** the user clicks a shop's point or table row
- **THEN** they land on that merchant's existing detail page

### Requirement: Merchant activity feed
The merchant detail page SHALL gain an Activity tab showing that shop's recent usage events (name, category, key properties, time) as a cursor-paginated feed with a hard page cap, read from the control plane's own mirror table. Impersonated events SHALL be visibly badged.

#### Scenario: Support context
- **WHEN** a support agent opens a merchant's Activity tab
- **THEN** they see the shop's recent actions newest-first and can page backwards, with impersonated entries clearly marked

### Requirement: Access control and freshness labeling
All usage procedures SHALL require the `view` ability (VIEWER and above); no write procedures exist. Every view SHALL display the "as of" timestamp of its underlying rollup, and the current day's numbers SHALL be visually marked provisional.

#### Scenario: Viewer access
- **WHEN** a VIEWER-role user opens any usage page
- **THEN** the page renders fully; no usage procedure rejects read access

#### Scenario: Provisional today
- **WHEN** the overview renders during the day
- **THEN** today's data points are visually distinguished and stamped with the last rollup time
