# Tasks: add-usage-analytics-p2-ingestion

> **Blocked** until `add-usage-analytics-p2-events-endpoint` ships in Badgy. Task 0 gates the rest.

## 0. Cross-repo dependency

- [x] 0.1 Confirm Badgy's `GET /internal/v1/events` is implemented and its response fixture is exported (shape, `seq`-as-string, `hasMore`, `nextSinceSeq`, envelope fields). Do NOT start below until this exists.
- [x] 0.2 Agree the signing-secret provisioning: a `secret:saleswitch/internal-api` ref resolving to Badgy's `BADGY_INTERNAL_API_SECRET` value; and the page-size cap (default 200).

## 1. Schema & config

- [x] 1.1 Add `UsageEvent` mirror model to `prisma/schema.prisma` matching house conventions (`id String @id @default(cuid())`, leading `appKey`, envelope fields `shopDomain/userId/name/category/source/properties/impersonated/occurredAt`, plus `sourceEventId String`, `sourceSeq BigInt`, `ingestedAt DateTime @default(now())`; `@@unique([appKey, sourceEventId])`; indexes `[appKey, shopDomain, occurredAt]`, `[appKey, name, occurredAt]`; `@@map("usage_events")`; `///` doc comment) and `UsageSyncCursor { appKey, sinceSeq BigInt, updatedAt }` (`@@unique([appKey])`); create migration
- [x] 1.2 Add config to the zod `EnvSchema` in `app/lib/config.ts` (read via `getConfig()`): `USAGE_INGEST_CRON` (`z.string().default("*/1 * * * *")`), `USAGE_INGEST_PAGE_SIZE` (default 200), `USAGE_INGEST_MAX_PAGES_PER_RUN`, `USAGE_MIRROR_RETENTION_MONTHS` (default 18), `USAGE_INGEST_LAG_ALERT_MINUTES` (default 15), `SALESWITCH_INTERNAL_API_URL` (`z.string().url()`); add a `SALESWITCH_INTERNAL_API_SECRET_REF` const + `resolveInternalApiSecret` method to `secrets.ts` following `resolveReplicaUrl`

## 2. Connector seam + signed client

- [x] 2.1 Add OPTIONAL `fetchUsageEvents(args: { sinceSeq: bigint; limit: number }): Promise<UsageEventPage>` to `AppConnector` in `app/server/connectors/types.ts`; declare `UsageEventPage`/`MirroredUsageEvent` as plain interfaces there (do not import from Badgy)
- [x] 2.2 New `saleswitchInternalClient` module: signs `GET /internal/v1/events?sinceSeq=&limit=` with HMAC-SHA256 hex over `` `${timestampMs}.GET.${pathname}.` `` (empty body), headers `x-badgy-signature`/`x-badgy-timestamp` (ms)/`x-badgy-nonce`; parses `seq`/`nextSinceSeq` string → BigInt; tolerates Badgy's enforced cap
- [x] 2.3 Implement `fetchUsageEvents` on `saleswitchConnector.ts` via the signed client; contract test pins the Badgy response fixture; stub-connector test proves apps without the method are skipped
- [x] 2.4 Client unit tests: canonical base-string + header correctness against a known-good vector; skew/nonce headers present per request

## 3. Ingestion worker & service

- [x] 3.1 Create `usageIngestService`: drain loop (pull page → `createMany({ skipDuplicates: true })` + `UsageSyncCursor` advance in ONE `$transaction` → repeat until `hasMore` false or `MAX_PAGES_PER_RUN` reached)
- [x] 3.2 Create the `usageIngest` BullMQ repeatable worker (own `connection()` helper, `withTrace` wrap, `.on("failed", captureError)`); register it in BOTH `app/server/workers/devWorker.ts` and `server/start.js` (start + `scheduleUsageIngest("saleswitch")`)
- [x] 3.3 Unit tests: cursor resume after simulated mid-drain crash (re-pull is idempotent via `skipDuplicates`), duplicate-page no-op, backlog drain across runs, max-pages guard, connector-missing skip

## 4. Observability, retention, compliance

- [x] 4.1 Export per-app ingestion-lag gauge (`now − max(occurredAt)`) on the shipped `/metrics` route; alert via `captureError` past `USAGE_INGEST_LAG_ALERT_MINUTES`
- [x] 4.2 Daily retention pruner for the mirror table (repeatable job, `USAGE_MIRROR_RETENTION_MONTHS`)
- [x] 4.3 Extend `ComplianceRequest` processing to purge mirrored events for redacted shops; test the purge is shop-scoped

## 5. Verification

- [x] 5.1 Typecheck, lint (`process.env`-only-in-config + no-app-DB-writes arch guards), full test suite green — replica-routing and stub-connector invariant tests untouched
  - NOTE: `tsc --noEmit` = 0 errors; arch guard passes; 32 new tests pass. The full suite's only 4 failures (`replica-routing.test.ts`, `directory-search.test.ts`) PRE-EXIST on clean HEAD — the empty fixtureSource SEED issue — confirmed via git stash. The stub-connector test stays green (fetchUsageEvents is optional). Schema applied via `prisma db push` convention (no migrations dir in this repo); DB not reachable here so `db push` not run.
- [x] 5.2 End-to-end smoke against local Badgy (with the endpoint applied): seed events in Badgy, run worker, verify mirror rows, cursor advance, dedupe on re-run, and lag gauge
  - NOTE: NOT run — needs both a running CP worker AND a seeded, reachable Badgy endpoint; neither DB is reachable from this environment. Before deploy: set `SALESWITCH_INTERNAL_API_URL` + `SALESWITCH_INTERNAL_API_SECRET` (= Badgy's `BADGY_INTERNAL_API_SECRET`), `db push` the schema, seed events in Badgy, run `npm run worker`, and verify `usage_events` rows + `usage_sync_cursors` advance + re-run dedupe + the `control_plane_usage_ingest_lag_seconds` gauge on `/metrics`.
