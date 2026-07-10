import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => {
  stubValidEnv();
  process.env.FEATURE_FLAGS_READ_TOKEN = "flag-secret";
});

const { isEnabled, rolloutBucket } = await import("~/lib/featureFlagEval.js");
const { FeatureFlagService } = await import("~/server/services/featureFlagService.js");
const { getAuditService } = await import("~/server/services/auditService.js");
const flagsRoute = await import("~/routes/api.flags.js");

const actor = { id: "admin1", email: "admin@apoaap.io", ip: null, userAgent: null };

function makeSvc(db: FakeDb) {
  return new FeatureFlagService(db as never, getAuditService());
}

/** cp-feature-flags — boolean registry + per-shop override + deterministic bucket. */
describe("featureFlagEval (pure)", () => {
  const flag = { appKey: "saleswitch", key: "new.ui", defaultEnabled: false, rolloutPercentage: 50 };

  it("lets an explicit override win over the percentage bucket", () => {
    expect(isEnabled(flag, true, "any.myshopify.com")).toBe(true);
    expect(isEnabled(flag, false, "any.myshopify.com")).toBe(false);
  });

  it("buckets deterministically (same shop → same result)", () => {
    const a = rolloutBucket("saleswitch", "new.ui", "aurora.myshopify.com");
    const b = rolloutBucket("saleswitch", "new.ui", "aurora.myshopify.com");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it("falls back to default when no override and no/zero rollout", () => {
    expect(isEnabled({ ...flag, rolloutPercentage: null }, null, "x.com")).toBe(false);
    expect(isEnabled({ ...flag, defaultEnabled: true, rolloutPercentage: 0 }, null, "x.com")).toBe(true);
    expect(isEnabled({ ...flag, rolloutPercentage: 100 }, null, "x.com")).toBe(true);
  });
});

describe("FeatureFlagService", () => {
  it("creates a flag and audits feature.flag.create", async () => {
    const db = new FakeDb();
    await makeSvc(db).create(actor, "saleswitch", { key: "beta", defaultEnabled: false });
    expect(db.store.featureFlag).toHaveLength(1);
    expect(db.store.auditLog.some((a) => a.action === "feature.flag.create")).toBe(true);
  });

  it("applies a per-shop override over the default and audits it", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.create(actor, "saleswitch", { key: "beta", defaultEnabled: false });
    await svc.setOverride(actor, "saleswitch", "beta", "vip.myshopify.com", true);
    const evalAll = await svc.evaluateForShop("saleswitch", "vip.myshopify.com");
    expect(evalAll.beta).toBe(true);
    expect(db.store.auditLog.some((a) => a.action === "feature.flag.override.set")).toBe(true);

    // A different shop with no override falls back to the (off) default.
    const other = await svc.evaluateForShop("saleswitch", "other.myshopify.com");
    expect(other.beta).toBe(false);
  });
});

describe("/api/flags read endpoint", () => {
  it("rejects a missing bearer token", async () => {
    const res = await flagsRoute.loader({
      request: new Request("https://cp.test/api/flags?shop=a.myshopify.com"),
    } as never);
    expect((res as Response).status).toBe(401);
  });

  it("rejects a wrong bearer token", async () => {
    const res = await flagsRoute.loader({
      request: new Request("https://cp.test/api/flags?shop=a.myshopify.com", {
        headers: { authorization: "Bearer nope" },
      }),
    } as never);
    expect((res as Response).status).toBe(401);
  });

  it("requires a shop param even with a valid token", async () => {
    const res = await flagsRoute.loader({
      request: new Request("https://cp.test/api/flags", {
        headers: { authorization: "Bearer flag-secret" },
      }),
    } as never);
    expect((res as Response).status).toBe(400);
  });
});
