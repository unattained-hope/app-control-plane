## ADDED Requirements

### Requirement: Content-hash dedupe

The system SHALL treat Shopify webhook delivery as at-least-once and dedupe on a
secondary content hash in addition to the primary `shopifyWebhookId` unique key. On
ingest it SHALL compute a SHA-256 `contentHash` of the raw body and, if an event with the
same `(appKey, topic, contentHash)` already exists, SHALL NOT enqueue a duplicate.

#### Scenario: Same webhook id is idempotent
- **WHEN** a webhook is redelivered with the same `shopifyWebhookId`
- **THEN** ingest does not create a second event and does not enqueue (unchanged from Tier 0)

#### Scenario: Same body, new id, recognized as duplicate
- **WHEN** a webhook is redelivered with a fresh `shopifyWebhookId` but an identical body for the same `(appKey, topic)`
- **THEN** the content-hash match prevents a duplicate enqueue

#### Scenario: Distinct event is not collapsed
- **WHEN** two genuinely distinct webhooks of the same topic arrive with different bodies
- **THEN** both are persisted and enqueued (distinct `contentHash`)

### Requirement: Attempt tracking and capped retry

The system SHALL track the number of processing `attempts` and `lastAttemptAt` on each
webhook event, retry failures with bounded exponential backoff up to a configured
`WEBHOOK_MAX_ATTEMPTS`, and SHALL NOT retry beyond that ceiling.

#### Scenario: Attempts increment per run
- **WHEN** processing a webhook event runs and fails transiently
- **THEN** `attempts` increments, `lastAttemptAt` updates, and the job is retried per backoff

#### Scenario: Retries stop at the ceiling
- **WHEN** `attempts` reaches `WEBHOOK_MAX_ATTEMPTS`
- **THEN** the event is not retried again and proceeds to the dead-letter transition

### Requirement: Dead-letter terminal state

The system SHALL add a `DEAD_LETTER` webhook status. On exhausting retries the worker
SHALL transition the event to `DEAD_LETTER` (terminal, never auto-retried) and SHALL
write an audit row (`webhook.dead_lettered`, `source: JOB`, `actorType: SYSTEM`).
`FAILED` SHALL remain the transient, retriable state.

#### Scenario: Exhausted event is dead-lettered
- **WHEN** a webhook event exhausts its retries
- **THEN** its status becomes `DEAD_LETTER` and a `webhook.dead_lettered` audit row is written with job provenance

#### Scenario: Dead-letter is not auto-retried
- **WHEN** an event is in `DEAD_LETTER`
- **THEN** no scheduled or background process re-enqueues it automatically

### Requirement: Failed-delivery view and audited replay

The system SHALL provide an `ops:view`-gated, server-paginated list of `FAILED` and
`DEAD_LETTER` webhook events (filterable by topic/status), and an ADMIN-only replay that
re-enqueues a dead-lettered event for reprocessing, recording a `webhook.replayed` audit
row in the same transaction as the re-enqueue. Reprocessing SHALL be idempotent.

#### Scenario: Failed deliveries are listed
- **WHEN** a user with `ops:view` opens the failed-delivery view
- **THEN** they see `FAILED`/`DEAD_LETTER` events with topic, status, attempts, and last error, paginated server-side

#### Scenario: Admin replays a dead-lettered event
- **WHEN** an ADMIN replays a `DEAD_LETTER` event
- **THEN** the event is re-enqueued (status reset to `RECEIVED`), a `webhook.replayed` audit row is written in the same transaction, and reprocessing does not duplicate the original side effect

#### Scenario: Non-admin cannot replay
- **WHEN** a user without ADMIN attempts to replay an event
- **THEN** the request is rejected with `FORBIDDEN`
