## ADDED Requirements

### Requirement: Mandatory compliance webhook handling

The control plane SHALL ingest and HMAC-verify the three mandatory Shopify
compliance webhooks — `customers/data_request`, `customers/redact`, and
`shop/redact` — via the shared webhook ingestion spine, and SHALL acknowledge each
with `200` so the app passes Shopify review. Each verified compliance webhook SHALL
upsert exactly one `ComplianceRequest` capturing the topic, shop, and the original
payload (customer ids / data-request body).

#### Scenario: Data request received

- **WHEN** a verified `customers/data_request` webhook is processed
- **THEN** a `ComplianceRequest` with topic `CUSTOMERS_DATA_REQUEST` is created for that shop with the payload retained

#### Scenario: Redaction requests received

- **WHEN** a verified `customers/redact` or `shop/redact` webhook is processed
- **THEN** a corresponding `ComplianceRequest` is created with the matching topic and `RECEIVED` status

#### Scenario: Duplicate compliance delivery

- **WHEN** the same compliance webhook is delivered more than once (at-least-once delivery)
- **THEN** the idempotent ingestion spine ensures only one `ComplianceRequest` is recorded

### Requirement: 30-day SLA timer

Every `ComplianceRequest` SHALL carry a `dueAt` equal to `receivedAt + 30 days`,
which drives the SLA against Shopify's 30-day completion mandate. A repeatable BullMQ
sweep SHALL flag requests that are still open and within a configured threshold of
`dueAt` (or past it), so breaching requests are surfaced before they expire.

#### Scenario: Due date derived on intake

- **WHEN** a `ComplianceRequest` is created with a given `receivedAt`
- **THEN** its `dueAt` equals `receivedAt` plus exactly 30 days

#### Scenario: Breach detection

- **WHEN** the SLA sweep runs and an open request is within the breach threshold of, or past, its `dueAt`
- **THEN** that request is flagged as breaching and surfaced/alerted, while requests comfortably before `dueAt` are not flagged

### Requirement: Same-transaction audit of fulfilment

The control plane SHALL write an `AuditLog` row in the SAME database transaction as
every `ComplianceRequest` state change — received, dispatched, completed, and failed —
using the existing append-only audit seam. If the audit insert fails, the state
change MUST roll back — no compliance transition may exist without an audit record.
Audit actions SHALL include `compliance.request.received`, `compliance.dispatched`,
`compliance.completed`, and `compliance.failed`.

#### Scenario: Transition is audited atomically

- **WHEN** a `ComplianceRequest` transitions to a new status
- **THEN** exactly one corresponding `AuditLog` row is written within the same transaction

#### Scenario: Audit failure rolls back the transition

- **WHEN** the audit insert fails during a compliance state change
- **THEN** the state change is rolled back and the request retains its prior status

### Requirement: Operator queue with SLA countdown

The control plane SHALL provide an operator page, under the authenticated shell, that
lists compliance requests in a table with a countdown-to-`dueAt` column, status
indicators, and filters. A "mark fulfilled" action SHALL require a type-to-confirm
guard consistent with other guarded actions and SHALL write the
`compliance.completed` audit row in the same transaction.

#### Scenario: Queue renders with countdown

- **WHEN** an authorized operator opens the compliance queue with a near-due seeded request
- **THEN** the request appears with a countdown reflecting time remaining until `dueAt`

#### Scenario: Mark fulfilled requires confirmation

- **WHEN** the operator marks a request fulfilled without passing the type-to-confirm guard
- **THEN** the action is rejected and no status change or audit row is written

### Requirement: ADMIN-gated compliance access

Compliance queue queries and mutations SHALL be guarded server-side by a
`compliance:manage` ability that is ADMIN-only in the CASL policy. Webhook ingestion
itself is unauthenticated (HMAC is the authentication); only the operator
UI/procedures are role-gated. A non-ADMIN calling a compliance procedure MUST receive
`FORBIDDEN`.

#### Scenario: Non-admin blocked

- **WHEN** a SUPPORT or VIEWER user calls a `compliance:manage` procedure
- **THEN** the server returns `FORBIDDEN` and performs no read or write

#### Scenario: Admin permitted

- **WHEN** an ADMIN user calls a compliance procedure
- **THEN** the request is authorized and served

### Requirement: A-phased auto-dispatch

Execution of the redaction/export SHALL be performed by dispatching to the narrow app
admin API when configured, because the control plane never mutates the app DB
directly. When the app admin API is NOT configured, the system
SHALL operate in a manual-fulfilment mode where an operator records completion, and
SHALL switch to automatic dispatch once the admin API endpoint exists — with no
change to the recorded audit/SLA contract.

#### Scenario: Manual fulfilment when admin API absent

- **WHEN** the app admin API is not configured and a compliance request needs action
- **THEN** the request stays operator-actionable and is completed by the manual "mark fulfilled" path

#### Scenario: Auto-dispatch when admin API present

- **WHEN** the app admin API is configured and a compliance request is processed
- **THEN** the worker dispatches the export/redaction to the app admin API, sets the request to in-progress with a dispatch timestamp, and audits `compliance.dispatched` — never mutating the app DB directly
