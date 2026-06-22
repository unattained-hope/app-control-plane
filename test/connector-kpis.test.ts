import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { SaleSwitchConnector } from "~/server/connectors/saleswitchConnector.js";
import { makeFixtureSource } from "~/server/connectors/fixtureSource.js";

// SaleSwitchConnector reads config (app-API gating) at construction.
beforeAll(() => stubValidEnv());

/** cp-kpi-dashboard — computeKpis produces the MVP metric set from the replica. */
describe("SaleSwitchConnector.computeKpis", () => {
  it("returns the MVP metric set with numeric values and ISO asOf", async () => {
    const connector = new SaleSwitchConnector(makeFixtureSource());
    const kpis = await connector.computeKpis();
    const metrics = kpis.map((k) => k.metric);
    for (const expected of [
      "active_merchants",
      "new_installs_7d",
      "new_installs_30d",
      "uninstalls",
      "plan_distribution",
      "mrr",
    ]) {
      expect(metrics).toContain(expected);
    }
    for (const k of kpis) {
      expect(typeof k.value).toBe("number");
      expect(() => new Date(k.asOf).toISOString()).not.toThrow();
    }
  });

  it("active_merchants equals the count of active fixture shops", async () => {
    const source = makeFixtureSource();
    const byStatus = await source.countByStatus();
    const connector = new SaleSwitchConnector(source);
    const kpis = await connector.computeKpis();
    const active = kpis.find((k) => k.metric === "active_merchants")!;
    expect(active.value).toBe(byStatus["active"] ?? 0);
  });
});
