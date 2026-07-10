## ADDED Requirements

### Requirement: SLO policy with multi-burn-rate tiers

The system SHALL define SLOs (starting with webhook-delivery success and request
availability) in a pure policy module, each carrying an objective and Google-SRE
multiwindow multi-burn-rate alert tiers: a fast page (~14.4× over short/long windows), a
slower page (~6×), and a ticket (~1×). The thresholds SHALL be configurable.

#### Scenario: Policy exposes objective and tiers
- **WHEN** the SLO policy is loaded for an SLO id
- **THEN** it returns the objective and the page/ticket burn-rate tiers with their windows

#### Scenario: Thresholds are tunable
- **WHEN** the configured burn-rate thresholds or windows change
- **THEN** evaluation uses the new values without code changes beyond config

### Requirement: Burn-rate evaluation over persisted metrics

The system SHALL evaluate burn rate by reading the persisted ops metrics over the policy's
short and long windows and SHALL flag a tier only when both windows confirm the burn (so a
single transient blip does not fire a page).

#### Scenario: Sustained burn fires a tier
- **WHEN** error rate over both the short and long windows exceeds a tier's burn-rate multiplier
- **THEN** that tier is flagged

#### Scenario: Transient blip does not page
- **WHEN** error rate spikes in the short window only and the long window is within budget
- **THEN** no page tier fires

#### Scenario: Within budget is quiet
- **WHEN** burn rate is below all tiers
- **THEN** no alert is emitted

### Requirement: Alert emission to the bought pager

When a tier fires, the system SHALL emit an alert signal through the existing Sentry sink
(`captureError`) tagged with the SLO id and severity (`page`/`ticket`) for the bought
on-call/paging vendor to consume, and SHALL record an audit row (`slo.alert.fired`,
`source: JOB`). The control plane SHALL NOT implement on-call scheduling or paging itself.

#### Scenario: Page tier emits a page-severity signal
- **WHEN** a page tier fires for an SLO
- **THEN** an alert signal with severity `page` and the SLO id is emitted via the Sentry sink and a `slo.alert.fired` audit row is written with job provenance

#### Scenario: Ticket tier emits a ticket-severity signal
- **WHEN** the 1× ticket tier fires
- **THEN** a `ticket`-severity signal is emitted (no page)

#### Scenario: On-call policy is documented, not coded
- **WHEN** reviewing the deliverable
- **THEN** the on-call rotation, escalation, and error-budget policy live in `docs/slo-policy.md`, and no pager/scheduler is built in the control plane
