## ADDED Requirements

### Requirement: Liveness and readiness probes

The system SHALL expose an unauthenticated `/healthz` liveness probe that returns `200`
while the process is up, and a `/readyz` readiness probe that returns `200` only when the
control-plane database and Redis are reachable and `503` otherwise. Neither probe SHALL
expose merchant data.

#### Scenario: Liveness is up
- **WHEN** the process is running and `/healthz` is requested
- **THEN** the response is `200`

#### Scenario: Readiness reflects dependencies
- **WHEN** the control-plane DB or Redis is unreachable and `/readyz` is requested
- **THEN** the response is `503` so an orchestrator can pull the instance from rotation

#### Scenario: Probes leak no data
- **WHEN** either probe responds
- **THEN** the body is an up/down status only, with no shop, merchant, or customer data

### Requirement: Synthetic transaction checks

The system SHALL provide Playwright synthetic transaction scripts that exercise a real
user journey (sign-in → merchant search → open inbox → assert expected content) in a real
browser and capture a screenshot on failure, reusing the in-repo Playwright harness.

#### Scenario: Happy-path journey passes
- **WHEN** the synthetic script runs against a healthy environment
- **THEN** it completes the journey and asserts the expected content without error

#### Scenario: Failure captures a screenshot
- **WHEN** a step in the synthetic journey fails
- **THEN** the run captures a screenshot artifact for diagnosis and reports failure

### Requirement: Public status page is bought and wired

The branded public status page SHALL be provided by a third-party vendor that monitors
`/healthz` and the synthetic checks; the control plane SHALL NOT build the status page.
The wiring and the incident-communications cadence SHALL be documented.

#### Scenario: Vendor consumes the probes
- **WHEN** the bought status page is configured
- **THEN** it monitors `/healthz` and the synthetic checks as its signal source

#### Scenario: Incident cadence is documented
- **WHEN** reviewing the deliverable
- **THEN** `docs/status-page.md` documents the vendor wiring and the comms cadence (minor every ~60 min; major/critical every ~15–20 min)
