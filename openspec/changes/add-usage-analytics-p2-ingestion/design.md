# Design: add-usage-analytics-p2-ingestion

## Context

The control plane already ingests one external event stream: Shopify webhooks land in `WebhookEvent` with dedupe, retry, and dead-letter handling, processed by a BullMQ worker (`app/server/services/webhookService.ts`, `app/server/workers/webhookProcess.ts`) — the structural template for this change. Badgy's Phase-2 counterpart will expose `GET /internal/v1/events` — cursor-paginated (`sinceSeq`/`limit`), HMAC-signed (reusing Badgy's shipped `internalAuth`), ordered by a monotonic `seq`. This change adds the pull side and the mirror store that Phase 3 rollups and the Phase 4 activity feed read.

**Two facts constrain the design and diverge from the plan-time draft:**
1. **The Badgy endpoint is not built yet.** Only Phase 1 (emitter + `usage_events` table with the `seq BigInt @unique @default(autoincrement())` cursor) shipped. This change is blocked on `add-usage-analytics-p2-events-endpoint` landing in Badgy.
2. **The control plane has no outbound signed-HTTP machinery.** The shipped `saleswitchConnector.ts` reads a replica/fixture source, not HTTP; the only outbound app call (`merchantActionService.ts`, D2 admin API) is a plain Bearer-token `fetch`. So the HMAC client here is net-new — there is no "existing Badgy internal call" or signing helper to reuse in this repo. The scheme it must reproduce lives entirely on the Badgy side (`server/lib/internalAuth.ts`, `shared/constants.ts`).

## Goals / Non-Goals

**Goals:**
- Every committed Badgy event eventually appears exactly once in the control-plane mirror (at-least-once delivery + idempotent insert = exactly-once effect).
- Survives downtime on either side with no data loss: the cursor only advances after a page is durably stored.
- Multi-app from day one: cursor and ingestion are keyed by `appKey`; a second app is a connector method + registry row, no core changes (existing invariant).
- Operators can see ingestion health (lag gauge, Sentry alert).

**Non-Goals:**
- No aggregation or metric computation (Phase 3).
- No UI (Phase 4).
- No push ingestion endpoint — pull-only, matching the plan's transport decision.

## Decisions

1. **Pull worker over inbound push route.** A repeatable BullMQ job (default ~60 s cadence via a config cron knob, following the `GROWTH_ROLLUP_CRON` precedent) drains the endpoint until `hasMore: false`. Rationale: Badgy keeps zero outbound credentials; control-plane downtime just pauses the cursor; backpressure is natural (we only pull what we can store). Alternative — Badgy POSTs batches to a CP route (rejected: new credential surface, retry/buffer logic duplicated on the producer, contradicts the established pull philosophy). Registration follows the shipped two-site pattern: `startUsageIngestWorker()` + `scheduleUsageIngest("saleswitch")` wired in BOTH `app/server/workers/devWorker.ts` and `server/start.js`; the BullMQ handler wraps in `withTrace(...)` and ends with `.on("failed", …captureError…)` like every other worker; the `connection()` helper is duplicated per-worker (not shared), matching `webhookProcess.ts`/`kpiRollup.ts`.
2. **New outbound HMAC client, reproducing Badgy's shipped scheme byte-for-byte.** No signing helper exists in this repo, so a new `saleswitchInternalClient` module signs each request: HMAC-SHA256 hex over `` `${timestampMs}.${METHOD}.${pathname}.${rawBody}` `` (pathname only, no query; empty body for GET), sent as `x-badgy-signature` / `x-badgy-timestamp` (epoch **ms** string) / `x-badgy-nonce` (unique). Must stay within Badgy's 5-min skew and single-use-nonce rules. The signing secret resolves through the `SecretsManager` (`secret:saleswitch/internal-api` ref) so no raw value sits in env/code — mirroring `resolveReplicaUrl`.
3. **Cursor persisted in its own row, advanced in the same transaction as the page insert.** `UsageSyncCursor { appKey, sinceSeq }` updated atomically with `createMany`. Crash between pages re-pulls the last page; `skipDuplicates` on `@@unique([appKey, sourceEventId])` makes the replay harmless.
4. **`createMany(skipDuplicates)` for dedupe rather than per-row upsert.** One statement per page, unique-constraint-driven idempotency. `sourceEventId` ⇐ Badgy's per-row cuid `id`; `sourceSeq` ⇐ Badgy's `seq`, parsed to BigInt from the endpoint's string encoding at the client boundary. (This differs from the shipped `webhookService.ts` per-row try/catch dedupe — a batch `skipDuplicates` is cheaper for a paged pull.)
5. **Page at whatever cap Badgy enforces; do not assume 1000.** Every shipped Badgy internal route caps at `INTERNAL_API_MAX_PAGE_SIZE = 200`. The client requests a configurable page size (default 200 to match) and trusts Badgy's returned page + `hasMore`; the drain loop is correct at any cap. A `USAGE_INGEST_MAX_PAGES_PER_RUN` guard bounds a single run so a large backlog can't run unbounded (remainder picked up next tick).
6. **Connector-mediated fetch.** The `AppConnector` interface (`app/server/connectors/types.ts`) gains OPTIONAL `fetchUsageEvents({ sinceSeq, limit }): Promise<UsageEventPage>` (page shape declared as a plain interface in `types.ts`, NOT imported from Badgy — matching the hand-declared `RawShopRow` convention). The worker skips apps whose connector doesn't implement it; a stub-connector test proves the skip.
7. **Lag as a first-class signal.** Gauge = `now − max(occurredAt ingested)` per app, exported on the shipped `/metrics` route; alert via `captureError`/Sentry past a configurable threshold (default 15 min). An analytics pipeline that silently stalls is worse than one that loudly fails.
8. **Mirror retention mirrors Badgy's (default 18 months, config knob).** Same daily pruner pattern; aggregates (Phase 3) are permanent, so pruning the mirror loses nothing the dashboards need.
9. **Compliance purge included here.** The existing `ComplianceRequest` flow gains a step that deletes mirrored events for a redacted shop, keeping the two stores consistent.

All new env vars are added to the single zod `EnvSchema` in `app/lib/config.ts` and read via `getConfig()` (the only place `process.env` is touched). Numeric knobs use `z.coerce.number().int().positive().default(N)`; the cron uses `z.string().default(...)`; a boolean, if any, uses the string-transform idiom (never `z.coerce.boolean()`).

## Risks / Trade-offs

- [Poll interval bounds freshness to ~1 min] → acceptable for product analytics; interval is config, not code.
- [Huge backlog after long downtime] → drain loop is O(pages); a max-pages-per-run guard prevents a single job from running unbounded, remainder picked up next tick.
- [Contract drift with Badgy's endpoint] → ingestion tests pin the response fixture exported by the Badgy change; BigInt-as-string handled at the client boundary.
- [Duplicate `sourceEventId` across apps] → uniqueness is scoped `(appKey, sourceEventId)`; ids never compared across apps.

## Migration Plan

Additive migration (two tables in the control-plane DB). **Blocked on the Badgy endpoint shipping** — implement/deploy only after `add-usage-analytics-p2-events-endpoint` is applied in Badgy. First run backfills from `sinceSeq = 0` (bounded by Badgy's own 18-month retention). Rollback: disable the repeatable job; tables remain.

## Open Questions

- **Signing secret ref + value.** The `secret:saleswitch/internal-api` ref must resolve to the same value as Badgy's `BADGY_INTERNAL_API_SECRET`. Coordinate the provisioning with the Badgy side before deploy. (The plan-time note that this was "the same pattern as existing `*_TOKEN` config" was wrong — those are Bearer tokens; this is an HMAC shared secret.)
- **Page-size cap.** Confirm with the Badgy side whether the events endpoint keeps the shipped `INTERNAL_API_MAX_PAGE_SIZE = 200` cap or adds a larger events-specific one. Default the client to 200 either way.
- **`seq` wire type.** The Badgy endpoint must serialize `seq`/`nextSinceSeq` as a JSON string (BigInt is not JSON-native). Pin it with the shared response fixture (task 2.3).
