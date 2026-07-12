// app/server/services/usageIngestService.ts
// Pulls an app's usage-event stream into the CP mirror (usage-analytics Phase 2b).
// The drain loop: pull a cursor page → insert idempotently + advance the cursor in
// ONE transaction → repeat until the endpoint reports no more events or a per-run
// page cap is hit. At-least-once delivery + a unique-constraint dedupe key =
// exactly-once effect: a crash mid-drain re-pulls the last page harmlessly.
//
// Testable without BullMQ or a real DB: the DB is DI'd (FakeDb in tests) and the
// per-app fetcher is a DI'd function (a stub in tests), following the
// growthMetricsService ShopLister pattern.

import { getDb } from "../db.js";
import { getConfig } from "~/lib/config.js";
import { getConnector } from "../connectors/registry.js";
import { captureError } from "~/lib/observability.js";
import type { UsageEventPage } from "../connectors/types.js";

/** Fetches one cursor page for an app, or null when the app doesn't emit usage events. */
export type UsageEventFetcher = (
  appKey: string,
  args: { sinceSeq: bigint; limit: number },
) => Promise<UsageEventPage | null>;

/** Default fetcher: routes through the app connector's optional method. */
export const connectorFetchUsageEvents: UsageEventFetcher = async (appKey, args) => {
  const connector = await getConnector(appKey);
  if (!connector.fetchUsageEvents) return null; // app doesn't emit usage events → skip
  return connector.fetchUsageEvents(args);
};

export interface UsageIngestResult {
  readonly skipped: boolean; // connector has no fetchUsageEvents
  readonly pages: number;
  readonly inserted: number; // rows actually written (excludes dedup no-ops)
  readonly cursor: bigint; // final cursor after the run
}

// Minimal DB surface this service needs — kept narrow so FakeDb satisfies it.
interface IngestDb {
  usageSyncCursor: {
    findUnique(args: { where: { appKey: string } }): Promise<{ sinceSeq: bigint } | null>;
    upsert(args: {
      where: { appKey: string };
      create: { appKey: string; sinceSeq: bigint };
      update: { sinceSeq: bigint };
    }): Promise<unknown>;
  };
  usageEvent: {
    createMany(args: {
      data: readonly Record<string, unknown>[];
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
  $transaction<T>(fn: (tx: IngestDb) => Promise<T>): Promise<T>;
}

export class UsageIngestService {
  constructor(
    private readonly db: IngestDb = getDb() as unknown as IngestDb,
    private readonly fetcher: UsageEventFetcher = connectorFetchUsageEvents,
    private readonly pageSize: number = getConfig().USAGE_INGEST_PAGE_SIZE,
    private readonly maxPagesPerRun: number = getConfig().USAGE_INGEST_MAX_PAGES_PER_RUN,
  ) {}

  /**
   * Drain new events for one app. Returns a summary. Never throws for expected
   * conditions (a connector without the method is a clean skip); unexpected fetch
   * errors propagate to the caller (the worker) for retry/observability.
   */
  async ingest(appKey: string): Promise<UsageIngestResult> {
    const cursorRow = await this.db.usageSyncCursor.findUnique({ where: { appKey } });
    let cursor = cursorRow?.sinceSeq ?? 0n;

    let pages = 0;
    let inserted = 0;
    for (; pages < this.maxPagesPerRun; pages += 1) {
      const page = await this.fetcher(appKey, { sinceSeq: cursor, limit: this.pageSize });
      if (page === null) {
        // Connector doesn't implement fetchUsageEvents → nothing to ingest.
        return { skipped: true, pages: 0, inserted: 0, cursor };
      }
      const nextSeq = BigInt(page.nextSinceSeq);

      if (page.events.length > 0) {
        const rows = page.events.map((e) => ({
          appKey,
          sourceEventId: e.id,
          sourceSeq: BigInt(e.seq),
          shopDomain: e.shopDomain,
          userId: e.userId,
          name: e.name,
          category: e.category,
          source: e.source,
          properties: e.properties ?? undefined,
          impersonated: e.impersonated,
          occurredAt: new Date(e.occurredAt),
        }));

        // Insert the page AND advance the cursor atomically. A crash after this
        // commit re-pulls nothing already stored; a crash before it re-pulls the
        // page and skipDuplicates makes the retry a no-op.
        const written = await this.db.$transaction(async (tx) => {
          const { count } = await tx.usageEvent.createMany({
            data: rows,
            skipDuplicates: true,
          });
          await tx.usageSyncCursor.upsert({
            where: { appKey },
            create: { appKey, sinceSeq: nextSeq },
            update: { sinceSeq: nextSeq },
          });
          return count;
        });
        inserted += written;
      }

      cursor = nextSeq;
      if (!page.hasMore) {
        pages += 1; // count the final page we just processed
        break;
      }
    }

    return { skipped: false, pages, inserted, cursor };
  }
}

let instance: UsageIngestService | null = null;
export function getUsageIngestService(): UsageIngestService {
  if (instance === null) instance = new UsageIngestService();
  return instance;
}

/** Test seam. */
export function __setUsageIngestService(fake: UsageIngestService | null): void {
  instance = fake;
}

/** Wrap `ingest` with error capture for the worker call site. */
export async function runUsageIngest(appKey: string): Promise<void> {
  try {
    await getUsageIngestService().ingest(appKey);
  } catch (err) {
    captureError(err, { job: "usage-ingest", appKey });
    throw err; // let BullMQ retry
  }
}
