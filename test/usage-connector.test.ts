// test/usage-connector.test.ts
// The connector exposes fetchUsageEvents ONLY when a signed internal client is
// injected, so the ingest worker's `if (!connector.fetchUsageEvents) skip` works.
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { SaleSwitchConnector } from "~/server/connectors/saleswitchConnector.js";
import { makeFixtureSource } from "~/server/connectors/fixtureSource.js";
import type { SaleSwitchInternalClient } from "~/server/connectors/saleswitchInternalClient.js";
import { USAGE_EVENTS_PAGE_FIXTURE } from "./fixtures/usageEventsPage.fixture.js";

beforeAll(() => stubValidEnv());

describe("SaleSwitchConnector.fetchUsageEvents", () => {
  it("is UNDEFINED when no internal client is configured (worker skips the app)", () => {
    const connector = new SaleSwitchConnector(makeFixtureSource());
    expect(connector.fetchUsageEvents).toBeUndefined();
  });

  it("is present and delegates to the injected client when configured", async () => {
    const calls: Array<{ sinceSeq: bigint; limit: number }> = [];
    const fakeClient = {
      async fetchUsageEvents(args: { sinceSeq: bigint; limit: number }) {
        calls.push(args);
        return USAGE_EVENTS_PAGE_FIXTURE;
      },
    } as unknown as SaleSwitchInternalClient;

    const connector = new SaleSwitchConnector(makeFixtureSource(), fakeClient);
    expect(typeof connector.fetchUsageEvents).toBe("function");

    const page = await connector.fetchUsageEvents!({ sinceSeq: 7n, limit: 200 });
    expect(page).toEqual(USAGE_EVENTS_PAGE_FIXTURE);
    // The page conforms to the connector's own UsageEventPage type (seq is a string).
    expect(typeof page.events[0]?.seq).toBe("string");
    expect(calls).toEqual([{ sinceSeq: 7n, limit: 200 }]);
  });
});
