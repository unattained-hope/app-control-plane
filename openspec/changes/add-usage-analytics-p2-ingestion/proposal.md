# Proposal: add-usage-analytics-p2-ingestion

> Phase 2 (control-plane half) of the usage-analytics plan (`badgy/docs/research/usage-analytics-2026/index.html`).
> Counterpart: `add-usage-analytics-p2-events-endpoint` in the Badgy repo (provides `GET /internal/v1/events`).
> Feeds Phase 3 (`add-usage-analytics-p3-rollups`).
>
> **Hard dependency (not yet met):** the Badgy events endpoint has NOT shipped. As of this revision Badgy has only Phase 1 (the emitter + `usage_events` table); `internal.v1.events` and `UsageEventRepository.findSince` exist only as the Badgy proposal. This change cannot be implemented until `add-usage-analytics-p2-events-endpoint` is applied in Badgy. The contract below is pinned to that proposal AND to the shipped Badgy internal-auth scheme (`server/lib/internalAuth.ts`) it will reuse.

## Why

The plan's approved decision D2: raw usage events are mirrored into the control plane's own database so dashboards, per-merchant activity feeds, and future metrics can be computed over history without ever touching an app's production DB. Badgy will expose a cursor-paginated events endpoint; the control plane needs the ingestion side — a resilient poller with dedupe, cursor persistence, and retention — following the same patterns as the shipped `WebhookEvent` ingestion (`prisma/schema.prisma` `WebhookEvent`, `app/server/services/webhookService.ts`, `app/server/workers/webhookProcess.ts`).

## What Changes

- New `UsageEvent` model (mirror table) in the control-plane Prisma schema: the Badgy envelope (`shopDomain`, `userId`, `name`, `category`, `source`, `properties`, `impersonated`, `occurredAt`) plus `appKey`, `sourceEventId` (= Badgy's per-row cuid `id`), `sourceSeq` (= Badgy's `seq`, a BigInt), and `ingestedAt`. `@@unique([appKey, sourceEventId])` for idempotent inserts.
- New `UsageSyncCursor` model persisting the per-app `sinceSeq` cursor (advanced in the same transaction as each page's insert).
- New `usageIngest` BullMQ **repeatable** job (cron cadence, default ~60 s): calls the connector's `fetchUsageEvents`, drains pages until `hasMore` is false (bounded by a max-pages-per-run guard), inserts each page with `createMany({ skipDuplicates: true })` on `(appKey, sourceEventId)`, advances the cursor transactionally with the page insert.
- **New outbound signed HTTP client** (this is the control plane's FIRST outbound signed call — no HMAC client exists in the repo today; the shipped SaleSwitch connector is replica/fixture-based and the only other outbound call, the D2 admin API, is Bearer-token, not HMAC). The client reproduces Badgy's shipped internal-auth scheme exactly: HMAC-SHA256 hex over the canonical base `` `${timestampMs}.${METHOD}.${pathname}.${rawBody}` ``, sent as headers `x-badgy-signature`, `x-badgy-timestamp` (epoch **ms**), `x-badgy-nonce` (unique per request). 5-minute timestamp skew, single-use nonce.
- Connector seam extension: an **optional** `fetchUsageEvents({ sinceSeq, limit }): Promise<UsageEventPage>` method on the `AppConnector` interface (`app/server/connectors/types.ts`), implemented for SaleSwitch via the new signed client. The ingest job skips apps whose connector doesn't implement it.
- **New config + secret**: a Badgy internal-API base URL var and a shared HMAC signing secret. Neither exists today — the shipped app-facing vars are `SALESWITCH_REPLICA_URL`, `SALESWITCH_ADMIN_API_URL`, `SALESWITCH_ADMIN_API_TOKEN` only. The signing secret follows the `secrets.ts` `secret:saleswitch/<name>` ref convention (add a `resolve*` method), matching the Badgy secret `BADGY_INTERNAL_API_SECRET`.
- Ingestion-lag observability: a per-app gauge (now − newest ingested `occurredAt`) surfaced on the shipped `/metrics` route and alerted via the shipped Sentry/observability path (`captureError`) past a threshold.
- Retention pruner for the mirror table (default 18 months, matching Badgy's window), plus a `ComplianceRequest` purge step that deletes mirrored events for a redacted shop.

## Capabilities

### New Capabilities
- `usage-event-ingestion`: pull-based, exactly-once-effective mirroring of app usage events into the control-plane DB — polling cadence, cursor semantics, dedupe, failure handling, retention, and lag observability.

### Modified Capabilities
<!-- none — the AppConnector interface gains one OPTIONAL method (additive); existing connector requirements unchanged. -->

## Impact

- **Prisma:** two new models + migration in the control plane's own DB (`CONTROL_PLANE_DATABASE_URL`) — writes stay in the control-plane DB, invariant preserved.
- **Server:** new `usageIngest` worker (registered in BOTH `app/server/workers/devWorker.ts` and `server/start.js` per the two-site pattern), new `usageIngestService`, new signed HTTP client module, `fetchUsageEvents` on `saleswitchConnector.ts` + the `AppConnector` interface, config additions (ingest cron, page size, max-pages-per-run, retention months, lag threshold, Badgy internal-API URL + signing-secret ref) in `app/lib/config.ts` via the zod `EnvSchema`.
- **Security:** the CP's first outbound HMAC-signed request; signing secret via the secrets manager (`secret:saleswitch/*` ref), never a raw value in env/code; requests carry a single-use nonce and a fresh timestamp.
- **Invariants:** unaffected — no reads of app primaries (HTTP contract, not the replica), dashboards still read snapshots only (Phase 3/4 concern), all writes land in the control-plane DB, `process.env` read only in `app/lib/config.ts`.

## Open questions / cross-repo coordination

- **Page-size cap conflict.** This change and the Badgy endpoint proposal both assume default 500 / cap 1000, but every shipped Badgy internal route caps at `INTERNAL_API_MAX_PAGE_SIZE = 200` (`shared/constants.ts`). Either the Badgy endpoint adds a larger events-specific cap, or ingestion pages at ≤200. **Recommendation: page at the existing 200 cap** and drain — no new Badgy constant needed. The ingest client must tolerate whatever cap Badgy enforces regardless.
- **`seq` wire encoding.** The mirror's `sourceSeq` is a BigInt; JSON can't carry BigInt natively. The Badgy endpoint must serialize `seq` as a string (or number ≤ 2^53); the ingest client parses it to BigInt at the boundary. This must be pinned by a shared response fixture the Badgy change exports and this change's tests import.
- **Signing-secret name.** The exact secrets-manager ref for the Badgy HMAC secret is still to be decided with the Badgy side (must equal Badgy's `BADGY_INTERNAL_API_SECRET` value).
