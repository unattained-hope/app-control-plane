# usage-cohort-assignment

## ADDED Requirements

### Requirement: Cohort snapshot model
The system SHALL store per-shop cohort assignments in a `UsageCohortSnapshot` model carrying `appKey`, `shop`, `lifecycle`, `intensity`, `personaTags` (string array), `activityScore`, and `computedAt`. Snapshots are point-in-time and append-only per run — history of segment movement is preserved.

#### Scenario: Segment movement visible over time
- **WHEN** a shop is ENGAGED in one nightly run and DORMANT a month later
- **THEN** both snapshots exist so the transition and its timing are queryable

### Requirement: Lifecycle stage assignment
A nightly job SHALL assign every known shop exactly one lifecycle stage: NEW (installed under 7 days), ONBOARDING (installed, no campaign ever activated), ACTIVATED (first campaign activated, within its first 30 days of activity), ENGAGED (usage events in the trailing 30 days), DORMANT (no events in 30 days, still installed), CHURNED (uninstalled). Precedence rules SHALL make the assignment deterministic.

#### Scenario: Dormant paid shop
- **WHEN** an installed shop on a paid plan has no usage events for 35 days
- **THEN** its nightly snapshot is DORMANT — surfacing it for churn-save outreach

### Requirement: Usage intensity assignment
The job SHALL compute a 30-day weighted activity score per shop (default weights: campaigns activated ×5, wizard sessions ×2, template edits ×1, active days ×1 — configurable) and bucket shops into POWER / REGULAR / LIGHT by configured percentile cut-points, with INACTIVE for zero score. Impersonated events SHALL NOT contribute.

#### Scenario: Weights are configuration
- **WHEN** an operator changes a weight in config
- **THEN** the next nightly run reflects it with no code change

### Requirement: Feature persona assignment
The job SHALL assign zero or more persona tags per shop from configured rule thresholds over feature-usage counts — initial set: DISCOUNT_ORCHESTRATOR, BADGE_DESIGNER, BANNER_BROADCASTER, AUTOMATION_USER (recurrence or Flow used ≥2 times), MULTI_MARKET (markets sync enabled), MINIMALIST (active with minimal feature breadth).

#### Scenario: Multi-persona shop
- **WHEN** a shop heavily uses badges and recurrence
- **THEN** its snapshot carries both BADGE_DESIGNER and AUTOMATION_USER
