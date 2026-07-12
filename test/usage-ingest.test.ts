// test/usage-ingest.test.ts
// The drain loop: idempotent inserts + transactional cursor advance, resilient to
// crashes and backlog. Uses FakeDb (in-memory) + a stub fetcher — no BullMQ, no DB.
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import {
  UsageIngestService,
  type UsageEventFetcher,
} from "~/server/services/usageIngestService.js";
import type { UsageEventPage, MirroredUsageEvent } from "~/server/connectors/types.js";

beforeAll(() => stubValidEnv());

/** Build a mirrored event with sensible defaults. */
function ev(seq: number, over?: Partial<MirroredUsageEvent>): MirroredUsageEvent {
  return {
    id: `e${seq}`,
    seq: String(seq),
    shopDomain: "s.myshopify.com",
    userId: null,
    name: "page_viewed",
    category: "NAVIGATION",
    source: "UI",
    properties: null,
    impersonated: false,
    occurredAt: "2026-07-11T00:00:00.000Z",
    ...over,
  };
}

/** A fetcher backed by a fixed list of pages, returned in order. */
function pagedFetcher(pages: UsageEventPage[]): { fetcher: UsageEventFetcher; calls: bigint[] } {
  const calls: bigint[] = [];
  let i = 0;
  const fetcher: UsageEventFetcher = async (_appKey, args) => {
    calls.push(args.sinceSeq);
    return pages[i++] ?? { events: [], nextSinceSeq: String(args.sinceSeq), hasMore: false };
  };
  return { fetcher, calls };
}

function svc(db: FakeDb, fetcher: UsageEventFetcher, maxPages = 50) {
  return new UsageIngestService(db as never, fetcher, 200, maxPages);
}

describe("UsageIngestService.ingest", () => {
  it("mirrors a single page and advances the cursor", async () => {
    const db = new FakeDb();
    const { fetcher } = pagedFetcher([
      { events: [ev(1), ev(2)], nextSinceSeq: "2", hasMore: false },
    ]);
    const res = await svc(db, fetcher).ingest("saleswitch");
    expect(res.inserted).toBe(2);
    expect(res.cursor).toBe(2n);
    expect(db.store.usageEvent.length).toBe(2);
    const cursor = db.store.usageSyncCursor.find((c) => c.appKey === "saleswitch");
    expect(cursor?.sinceSeq).toBe(2n);
  });

  it("drains multiple pages until hasMore is false", async () => {
    const db = new FakeDb();
    const { fetcher, calls } = pagedFetcher([
      { events: [ev(1)], nextSinceSeq: "1", hasMore: true },
      { events: [ev(2)], nextSinceSeq: "2", hasMore: true },
      { events: [ev(3)], nextSinceSeq: "3", hasMore: false },
    ]);
    const res = await svc(db, fetcher).ingest("saleswitch");
    expect(res.inserted).toBe(3);
    expect(res.pages).toBe(3);
    expect(res.cursor).toBe(3n);
    // Each page resumed from the previous cursor.
    expect(calls).toEqual([0n, 1n, 2n]);
  });

  it("resumes from the stored cursor on a subsequent run", async () => {
    const db = new FakeDb();
    db.store.usageSyncCursor.push({ id: "c", appKey: "saleswitch", sinceSeq: 5n });
    const { fetcher, calls } = pagedFetcher([
      { events: [ev(6)], nextSinceSeq: "6", hasMore: false },
    ]);
    await svc(db, fetcher).ingest("saleswitch");
    expect(calls[0]).toBe(5n); // resumed past the stored cursor
  });

  it("is idempotent: re-pulling the same page inserts nothing new (skipDuplicates)", async () => {
    const db = new FakeDb();
    const page: UsageEventPage = { events: [ev(1), ev(2)], nextSinceSeq: "2", hasMore: false };
    // First run.
    await svc(db, pagedFetcher([page]).fetcher).ingest("saleswitch");
    // Simulate a crash-then-retry: reset the cursor to 0 so the same page re-pulls.
    const cursor = db.store.usageSyncCursor.find((c) => c.appKey === "saleswitch")!;
    cursor.sinceSeq = 0n;
    const res = await svc(db, pagedFetcher([page]).fetcher).ingest("saleswitch");
    expect(res.inserted).toBe(0); // all duplicates skipped
    expect(db.store.usageEvent.length).toBe(2); // no dupes stored
  });

  it("stops at the max-pages-per-run guard, leaving the remainder for next run", async () => {
    const db = new FakeDb();
    // Every page says hasMore: true → only the guard stops it.
    const { fetcher } = pagedFetcher([
      { events: [ev(1)], nextSinceSeq: "1", hasMore: true },
      { events: [ev(2)], nextSinceSeq: "2", hasMore: true },
      { events: [ev(3)], nextSinceSeq: "3", hasMore: true },
    ]);
    const res = await svc(db, fetcher, 2).ingest("saleswitch"); // cap = 2
    expect(res.pages).toBe(2);
    expect(res.inserted).toBe(2);
    expect(res.cursor).toBe(2n); // resumes at 2 next time
  });

  it("skips an app whose connector returns null (no fetchUsageEvents)", async () => {
    const db = new FakeDb();
    const fetcher: UsageEventFetcher = async () => null;
    const res = await svc(db, fetcher).ingest("otherapp");
    expect(res.skipped).toBe(true);
    expect(res.inserted).toBe(0);
    expect(db.store.usageEvent.length).toBe(0);
  });

  it("handles an empty page without advancing past the cursor incorrectly", async () => {
    const db = new FakeDb();
    db.store.usageSyncCursor.push({ id: "c", appKey: "saleswitch", sinceSeq: 9n });
    const { fetcher } = pagedFetcher([{ events: [], nextSinceSeq: "9", hasMore: false }]);
    const res = await svc(db, fetcher).ingest("saleswitch");
    expect(res.inserted).toBe(0);
    expect(res.cursor).toBe(9n);
    expect(db.store.usageEvent.length).toBe(0);
  });

  it("parses BigInt seqs beyond 2^53 without precision loss", async () => {
    const db = new FakeDb();
    const big = "9007199254740993";
    const { fetcher } = pagedFetcher([
      { events: [ev(0, { id: "big", seq: big })], nextSinceSeq: big, hasMore: false },
    ]);
    const res = await svc(db, fetcher).ingest("saleswitch");
    expect(res.cursor).toBe(BigInt(big));
    expect(db.store.usageEvent[0]?.sourceSeq).toBe(BigInt(big));
  });
});
