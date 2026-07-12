// test/usage-saved-views.test.ts
// Per-admin saved explorer views (cp usage-saved-views, P5): owner scoping (an admin sees
// + mutates only their own), per-user cap enforcement, params JSON round-trip, and the
// name-uniqueness guard. FakeDb drives the service; no audit (private preferences).
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => {
  stubValidEnv();
  // A tiny cap so the enforcement test is cheap + deterministic.
  process.env.USAGE_SAVED_VIEW_MAX_PER_USER = "2";
});

const {
  UsageSavedViewService,
  UsageSavedViewCapExceededError,
  UsageSavedViewNameConflictError,
  UsageSavedViewNotFoundError,
} = await import("~/server/services/usageSavedViewService.js");

const APP = "saleswitch";
const ADMIN_A = "adminA";
const ADMIN_B = "adminB";

function makeSvc(db: FakeDb) {
  return new UsageSavedViewService(db as never);
}

const params = { lifecycleFilter: "DORMANT", colorBy: "plan", xAxis: "tenureDays" };

describe("UsageSavedViewService — owner scoping", () => {
  it("returns only the acting admin's own views", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.create(APP, ADMIN_A, { name: "churn list", params });
    await svc.create(APP, ADMIN_B, { name: "b list", params });

    const aViews = await svc.list(APP, ADMIN_A);
    expect(aViews).toHaveLength(1);
    expect(aViews[0]!.name).toBe("churn list");

    const bViews = await svc.list(APP, ADMIN_B);
    expect(bViews.map((v) => v.name)).toEqual(["b list"]);
  });

  it("round-trips the params blob exactly", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const created = await svc.create(APP, ADMIN_A, { name: "churn list", params });
    const [restored] = await svc.list(APP, ADMIN_A);
    expect(restored!.params).toEqual(params);
    expect(created.params).toEqual(params);
  });

  it("forbids one admin from updating/deleting another admin's view (NOT_FOUND)", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const aView = await svc.create(APP, ADMIN_A, { name: "a private", params });

    await expect(svc.update(APP, ADMIN_B, aView.id, { name: "hijack" })).rejects.toBeInstanceOf(
      UsageSavedViewNotFoundError,
    );
    await expect(svc.remove(APP, ADMIN_B, aView.id)).rejects.toBeInstanceOf(
      UsageSavedViewNotFoundError,
    );
    // A's view is untouched.
    const [still] = await svc.list(APP, ADMIN_A);
    expect(still!.name).toBe("a private");
  });
});

describe("UsageSavedViewService — cap + uniqueness", () => {
  it("enforces the per-user cap", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.create(APP, ADMIN_A, { name: "v1", params });
    await svc.create(APP, ADMIN_A, { name: "v2", params });
    await expect(svc.create(APP, ADMIN_A, { name: "v3", params })).rejects.toBeInstanceOf(
      UsageSavedViewCapExceededError,
    );
    // The cap is PER-USER: another admin still has room.
    await expect(svc.create(APP, ADMIN_B, { name: "v1", params })).resolves.toBeDefined();
  });

  it("rejects a duplicate name within the same admin's set", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.create(APP, ADMIN_A, { name: "dupe", params });
    await expect(svc.create(APP, ADMIN_A, { name: "dupe", params })).rejects.toBeInstanceOf(
      UsageSavedViewNameConflictError,
    );
    // Same name is fine for a DIFFERENT admin (owner-scoped uniqueness).
    await expect(svc.create(APP, ADMIN_B, { name: "dupe", params })).resolves.toBeDefined();
  });

  it("renames + replaces params on the owner's own view", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const v = await svc.create(APP, ADMIN_A, { name: "old", params });
    const newParams = { lifecycleFilter: "ENGAGED", colorBy: "intensity" };
    const updated = await svc.update(APP, ADMIN_A, v.id, { name: "new", params: newParams });
    expect(updated.name).toBe("new");
    expect(updated.params).toEqual(newParams);
  });
});
