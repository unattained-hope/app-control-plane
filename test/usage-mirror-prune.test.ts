// test/usage-mirror-prune.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import { UsageMirrorPruneService } from "~/server/services/usageMirrorPruneService.js";

beforeAll(() => stubValidEnv());

describe("UsageMirrorPruneService.prune", () => {
  it("deletes rows older than the retention window, keeps recent + other apps", async () => {
    const db = new FakeDb();
    const now = new Date("2026-07-11T00:00:00Z");
    // retentionMonths = 6 → cutoff 2026-01-11.
    db.store.usageEvent.push(
      { id: "old", appKey: "saleswitch", occurredAt: new Date("2025-12-01T00:00:00Z") },
      { id: "recent", appKey: "saleswitch", occurredAt: new Date("2026-07-01T00:00:00Z") },
      { id: "other-old", appKey: "otherapp", occurredAt: new Date("2025-01-01T00:00:00Z") },
    );
    const svc = new UsageMirrorPruneService(db as never, 6);
    const count = await svc.prune("saleswitch", now);
    expect(count).toBe(1);
    const ids = db.store.usageEvent.map((r) => r.id).sort();
    expect(ids).toEqual(["other-old", "recent"]); // saleswitch/old gone; other app untouched
  });

  it("prunes nothing when all rows are within the window", async () => {
    const db = new FakeDb();
    const now = new Date("2026-07-11T00:00:00Z");
    db.store.usageEvent.push({
      id: "r",
      appKey: "saleswitch",
      occurredAt: new Date("2026-06-01T00:00:00Z"),
    });
    const svc = new UsageMirrorPruneService(db as never, 18);
    expect(await svc.prune("saleswitch", now)).toBe(0);
    expect(db.store.usageEvent.length).toBe(1);
  });
});
