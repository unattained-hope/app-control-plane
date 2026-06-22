import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { SaleSwitchConnector } from "~/server/connectors/saleswitchConnector.js";
import type { ReplicaReadSource } from "~/server/connectors/saleswitchConnector.js";
import { makeFixtureSource } from "~/server/connectors/fixtureSource.js";

// SaleSwitchConnector reads config (app-API gating) at construction.
beforeAll(() => stubValidEnv());

/** cp-app-registry-connector — replica-only invariant. */
describe("SaleSwitchConnector replica-only routing", () => {
  it("throws when constructed with a non-replica-only source (could reach primary)", () => {
    const primaryCapable = {
      ...makeFixtureSource(),
      isReplicaOnly: false,
    } as ReplicaReadSource;
    expect(() => new SaleSwitchConnector(primaryCapable)).toThrow();
  });

  it("constructs with a replica-only fixture source", () => {
    const connector = new SaleSwitchConnector(makeFixtureSource());
    expect(connector.key).toBe("saleswitch");
  });

  it("listMerchants returns the common MerchantRow shape, never raw rows", async () => {
    const connector = new SaleSwitchConnector(makeFixtureSource());
    const page = await connector.listMerchants({ page: 1, pageSize: 25 });
    expect(page.rows.length).toBeGreaterThan(0);
    const row = page.rows[0]!;
    // Common shape keys — not raw app-table columns like shopDomain/contactEmail.
    expect(Object.keys(row).sort()).toEqual(
      ["email", "installedAt", "name", "plan", "shop", "status"].sort(),
    );
    expect(typeof page.asOf).toBe("string");
  });
});
