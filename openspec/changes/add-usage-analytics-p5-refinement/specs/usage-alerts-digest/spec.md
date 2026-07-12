# usage-alerts-digest

## ADDED Requirements

### Requirement: Threshold alert rules over usage metrics
The system SHALL evaluate configurable alert rules (metric, dimension, comparison, threshold, window) against finalized daily usage metrics after each finalization run. Rules SHALL be stored as data and manageable by ADMIN users; evaluation MUST use finalized numbers only, never provisional intraday values.

#### Scenario: Funnel regression detected
- **WHEN** a rule watches the wizard-completed stage's weekly conversion and it drops by more than the configured threshold
- **THEN** an alert is delivered to the configured channel naming the metric, the delta, and the window

### Requirement: Breach-episode alerting semantics
Each rule SHALL track breach state. An alert fires when a rule transitions from OK to BREACHED; a recovery notice fires on BREACHED to OK; evaluations inside an ongoing episode fire nothing.

#### Scenario: Persistent breach stays quiet
- **WHEN** a breached rule remains breached across five daily evaluations
- **THEN** exactly one alert (plus, later, one recovery notice) is sent for the episode

### Requirement: Weekly usage digest
The system SHALL send a weekly digest through the existing notification/email infrastructure summarizing, from pre-rolled metrics only: WAU/MAU headline and trend, the largest funnel-stage movement, top and bottom feature-adoption movers, and counts of notable cohort transitions (e.g. ENGAGED→DORMANT). Recipients and schedule are configuration.

#### Scenario: Digest content is delta-focused
- **WHEN** the digest job runs
- **THEN** the message contains this-week-vs-last-week deltas computed from metric rows, with no raw-event queries

### Requirement: Dormant-shop workflow hook
When enabled by configuration, a shop's transition to DORMANT while on a paid plan SHALL apply a churn-risk tag to the merchant and MAY open an inbox item, exactly once per dormancy episode, reusing the existing tag/conversation models.

#### Scenario: Hook disabled by default
- **WHEN** the feature flag is off
- **THEN** cohort transitions produce no tags or inbox items
