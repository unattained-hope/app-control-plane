## ADDED Requirements

### Requirement: Shopify webhook resource route with dev/prod parity

The control plane SHALL expose a single Shopify webhook endpoint as a React Router
resource route (`webhooks/shopify`, `action`-only, no component) so it runs
identically under `react-router dev` and the production `server/start.js` handler,
mirroring the existing `trpc/*` route. The route SHALL read the raw request body
with `await request.text()` BEFORE any parsing, because the HMAC is computed over
the raw bytes.

#### Scenario: Webhook delivered in development and production

- **WHEN** Shopify POSTs a webhook to `/webhooks/shopify` under either the dev server or the production process
- **THEN** the same `action` handler receives the request, reads the raw body before parsing, and no Express-only path is required

#### Scenario: Non-POST method

- **WHEN** a request reaches `webhooks/shopify` with a method other than POST
- **THEN** the route rejects it without ingesting or enqueuing anything

### Requirement: HMAC signature verification

The endpoint SHALL verify each webhook by computing the base64 HMAC-SHA256 of the
raw body using the resolved app secret and comparing it to the
`X-Shopify-Hmac-Sha256` header with a constant-time comparison. A request with a
missing or invalid signature MUST be rejected with `401`, MUST NOT enqueue any job,
and SHALL be recorded as a `WebhookEvent` with `hmacValid: false` for forensics.

#### Scenario: Valid signature

- **WHEN** the computed HMAC of the raw body matches the `X-Shopify-Hmac-Sha256` header
- **THEN** the request is accepted and proceeds to idempotent persistence and enqueue

#### Scenario: Tampered body or wrong secret

- **WHEN** the raw body was altered or signed with the wrong secret so the HMAC does not match
- **THEN** the endpoint returns `401`, records a `WebhookEvent` with `hmacValid: false`, and enqueues no job

#### Scenario: Constant-time comparison

- **WHEN** the signature is compared against the header
- **THEN** a constant-time comparison is used so verification time does not leak signature bytes

### Requirement: Idempotent ingestion and fast acknowledgement

On a valid signature the endpoint SHALL persist a `WebhookEvent` keyed by a unique
`shopifyWebhookId` (from `X-Shopify-Webhook-Id`), enqueue a `webhook-process` BullMQ
job, and return `200` immediately without performing the real work inline. Because
Shopify guarantees at-least-once delivery, a duplicate `shopifyWebhookId` MUST be
recorded once and MUST NOT be enqueued a second time. Shopify retries on any non-2xx
response, so the handler MUST NOT block the response on processing.

#### Scenario: First delivery

- **WHEN** a webhook with a previously unseen `X-Shopify-Webhook-Id` is verified
- **THEN** exactly one `WebhookEvent` row is created, exactly one job is enqueued, and `200` is returned promptly

#### Scenario: Duplicate delivery

- **WHEN** a webhook arrives whose `X-Shopify-Webhook-Id` already has a `WebhookEvent`
- **THEN** no second row is created, no second job is enqueued, and `200` is still returned

#### Scenario: Processing failure does not block acknowledgement

- **WHEN** downstream processing would be slow or fail
- **THEN** the endpoint still returns `200` immediately and the work proceeds asynchronously in the worker

### Requirement: Topic fan-out worker

A `webhook-process` BullMQ queue and worker SHALL consume enqueued events,
switch on the Shopify `topic`, and route each to the appropriate handler (compliance
or billing). The worker SHALL be built on the same connection/backoff/`captureError`
structure as the existing KPI rollup worker, mark `WebhookEvent.status` as
`PROCESSED` on success or `FAILED` with an error on exhaustion, and SHALL be started
by the persistent process beside `startKpiWorker()`.

#### Scenario: Compliance topic routed

- **WHEN** the worker processes an event whose topic is a `customers/*` or `shop/redact` compliance topic
- **THEN** it invokes the compliance handler and marks the `WebhookEvent` `PROCESSED` on success

#### Scenario: Billing topic routed

- **WHEN** the worker processes an event whose topic is an `app_subscriptions/*` billing topic
- **THEN** it invokes the billing handler and marks the `WebhookEvent` `PROCESSED` on success

#### Scenario: Handler failure retries then fails

- **WHEN** a handler throws
- **THEN** BullMQ retries with exponential backoff, and on final exhaustion the `WebhookEvent` is marked `FAILED` with the error captured to observability

### Requirement: Per-app webhook secret resolution

The HMAC secret SHALL be resolved per app without hard-coding any tenant. For the
single-tenant MVP the endpoint MAY reuse the existing `SHOPIFY_API_SECRET` from the
validated config. For multi-app, the secret SHALL be resolved by mapping
shop → app (registry) → secret reference → secret via the secrets-manager seam, and
`process.env` MUST be accessed only through `app/lib/config.ts`.

#### Scenario: Single-tenant secret

- **WHEN** the MVP single tenant delivers a webhook
- **THEN** the HMAC is verified against the configured Shopify API secret with no raw `process.env` access outside `config.ts`

#### Scenario: Multi-app secret resolution

- **WHEN** a webhook arrives for a shop belonging to a registered app
- **THEN** the secret is resolved from that app's registry reference through the secrets-manager seam, requiring no core route edits to add an app
