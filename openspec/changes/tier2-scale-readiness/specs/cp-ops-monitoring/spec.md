## ADDED Requirements

### Requirement: Prometheus metrics endpoint

The system SHALL expose a `/metrics` endpoint in Prometheus text format that includes
BullMQ job counts per queue and state (`bullmq_job_count{queue,state}`) plus
control-plane gauges for webhook delivery failures, webhook dead-letters, and
compliance requests approaching/past due. The endpoint SHALL require a bearer token
(`METRICS_AUTH_TOKEN`) in addition to the zero-trust gateway, and SHALL NOT expose any
merchant PII.

#### Scenario: Authorized scrape returns metrics
- **WHEN** a scraper requests `/metrics` with the correct bearer token
- **THEN** the response is `200` Prometheus text including `bullmq_job_count{queue="webhook-process",state="failed"}` and the webhook/compliance gauges

#### Scenario: Missing or wrong token is rejected
- **WHEN** `/metrics` is requested without a valid `METRICS_AUTH_TOKEN` bearer
- **THEN** the response is `401`/`403` and no metrics body is returned

#### Scenario: Metrics carry no PII
- **WHEN** the metrics payload is rendered
- **THEN** it contains only counts/gauges (queue, state, topic, status labels) and no shop email, name, or customer data

### Requirement: Live queue health

The system SHALL read live per-queue job counts via BullMQ's `getJobCounts()` for every
registered queue (`kpi-rollup`, `webhook-process`, `compliance-sweep`, `sla-sweep`,
`ops-rollup`) without querying any application database.

#### Scenario: Backlog is visible
- **WHEN** the monitoring service reads queue health and a queue has waiting + active jobs
- **THEN** it reports the backlog (waiting/active) and failed counts for that queue

#### Scenario: No app-DB read for monitoring
- **WHEN** queue health is computed
- **THEN** the data comes from Redis/BullMQ and control-plane tables only, never the SaleSwitch replica or primary (the `check-no-app-db-writes` guard stays green and no raw SQL is issued)

### Requirement: Ops-KPI rollup for trends

The system SHALL run a repeatable background rollup that persists ops gauges (per-queue
failed/backlog counts, webhook failure rate, dead-letter count, compliance breaching
count) as `KpiSnapshot` rows with an `asOf` timestamp, so trend tiles render from
pre-aggregated rows rather than live joins.

#### Scenario: Rollup writes ops snapshots
- **WHEN** the ops rollup runs for an app
- **THEN** it appends `KpiSnapshot` rows for the ops metrics with the current `asOf` and the dashboard can read the latest per metric

#### Scenario: Rollup failure is captured, not fatal
- **WHEN** the ops rollup job throws
- **THEN** the failure is reported via `captureError` (queue + jobId context) and retried per the worker's attempts/backoff, and the web server keeps serving

### Requirement: Per-app monitoring dashboard

The system SHALL provide a monitoring route, gated by the `ops:view` ability, that
renders per-app tiles for queue backlog/failures, webhook failure rate and dead-letter
count, worker liveness, and a Sentry error-rate reference, enumerating apps via the app
registry. Each trend tile SHALL show its `asOf` timestamp.

#### Scenario: Ops viewer sees tiles
- **WHEN** a user with `ops:view` opens the monitoring route
- **THEN** they see per-app queue/webhook/worker tiles with `asOf` timestamps

#### Scenario: Viewer without ops:view is forbidden
- **WHEN** a user lacking `ops:view` calls a monitoring procedure
- **THEN** the request is rejected with `FORBIDDEN`

#### Scenario: Worker liveness reflected
- **WHEN** a queue has had no completed job within the configured liveness window
- **THEN** its worker-liveness tile renders as stale/unhealthy
