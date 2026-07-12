# usage-event-ingestion

## ADDED Requirements

### Requirement: Mirror table for app usage events
The control plane SHALL store ingested usage events in its own database in a `UsageEvent` model carrying the source envelope (shopDomain, userId, name, category, source, properties, impersonated, occurredAt) plus `appKey`, `sourceEventId` (the source event's own stable id — Badgy's per-row cuid), `sourceSeq` (the source's monotonic `seq`, stored as BigInt), and `ingestedAt`, with a unique constraint on `(appKey, sourceEventId)` and indexes supporting per-shop and per-time reads.

#### Scenario: Event mirrored once
- **WHEN** the same source event is delivered in two ingestion runs
- **THEN** exactly one mirror row exists for `(appKey, sourceEventId)`

### Requirement: Signed transport to the source endpoint
Ingestion SHALL call the source events endpoint with the source app's authentication scheme reproduced exactly. For SaleSwitch/Badgy that is HMAC-SHA256 (hex) over the canonical base `${timestampMs}.${METHOD}.${pathname}.${rawBody}`, presented as the `x-badgy-signature`, `x-badgy-timestamp` (epoch milliseconds), and `x-badgy-nonce` (unique-per-request) headers, within Badgy's timestamp-skew and single-use-nonce rules. The signing secret SHALL be resolved through the secrets manager, never read as a raw value in env or code. The request SHALL tolerate whatever page-size cap the endpoint enforces.

#### Scenario: Authenticated pull succeeds
- **WHEN** the ingest client requests a page with a fresh timestamp, unique nonce, and correct signature
- **THEN** the endpoint returns the page and the client mirrors it

#### Scenario: BigInt cursor over the wire
- **WHEN** the endpoint encodes `seq`/`nextSinceSeq` as JSON strings
- **THEN** the client parses them to BigInt at the boundary and stores/advances the cursor without precision loss

### Requirement: Cursor-based polling ingestion
A repeatable ingestion job SHALL run on a configurable cadence (default every 60 s) for each registered app whose connector implements `fetchUsageEvents`. Each run SHALL pull pages from the app's events endpoint starting at the persisted per-app cursor, insert each page idempotently, and advance the cursor in the same transaction as the page's insert, repeating until the endpoint reports no more events or a max-pages-per-run guard is reached.

#### Scenario: Normal incremental pull
- **WHEN** the job runs and Badgy has new events beyond the stored cursor
- **THEN** all new events are mirrored in order and the cursor equals the endpoint's returned `nextSinceSeq`

#### Scenario: Crash between page insert and next page
- **WHEN** the worker dies after committing a page and restarts
- **THEN** ingestion resumes from the committed cursor and re-delivered rows are skipped by the unique constraint

#### Scenario: Control-plane downtime
- **WHEN** ingestion is down for hours and restarts
- **THEN** the backlog is drained across successive runs with no gaps and no manual intervention

#### Scenario: Connector without usage events
- **WHEN** an app's connector does not implement `fetchUsageEvents`
- **THEN** the job skips that app without error

### Requirement: Ingestion lag observability
The system SHALL expose a per-app ingestion-lag gauge (time since the newest ingested `occurredAt`) on the metrics endpoint and SHALL raise a Sentry alert when lag exceeds a configurable threshold (default 15 minutes).

#### Scenario: Pipeline stalls
- **WHEN** no events are ingested for longer than the threshold while the app is emitting
- **THEN** an alert is raised identifying the app

### Requirement: Mirror retention and compliance purge
Mirrored events SHALL be pruned after a configurable retention window (default 18 months, matching the source), and processing a compliance redaction request for a shop SHALL delete all mirrored events for that shop.

#### Scenario: Shop redaction
- **WHEN** a `shop/redact` compliance request is processed for a shop
- **THEN** no mirrored usage events for that shop remain in the control-plane DB
