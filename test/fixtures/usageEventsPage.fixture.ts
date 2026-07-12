// test/fixtures/usageEventsPage.fixture.ts
// CP-side copy of Badgy's GET /internal/v1/events response fixture — the SHARED
// CONTRACT between the two repos (Badgy's source:
// server/services/__fixtures__/usageEventsPage.fixture.ts). Pinning this here
// means a wire-format change in Badgy that isn't mirrored breaks a CP test,
// instead of silently corrupting ingestion. Typed against the CP's own
// UsageEventPage so it also proves the connector page shape matches.
//
// Wire-format invariants:
//   - `seq`/`nextSinceSeq` are STRINGS (BigInt is not JSON-native; values exceed 2^53).
//   - `occurredAt` is ISO-8601; `id` is the dedupe key; `userId`/`properties` nullable.

import type { UsageEventPage } from "~/server/connectors/types.js";

export const USAGE_EVENTS_PAGE_FIXTURE: UsageEventPage = {
  events: [
    {
      id: "clzabc123def456ghi789jkl",
      seq: "1",
      shopDomain: "example.myshopify.com",
      userId: null,
      name: "app_installed",
      category: "LIFECYCLE",
      source: "SYSTEM",
      properties: { reinstall: false, scopes: "write_products" },
      impersonated: false,
      occurredAt: "2026-07-11T09:00:00.000Z",
    },
    {
      id: "clzabc123def456ghi789mno",
      // Beyond Number.MAX_SAFE_INTEGER — parsing as a JS number would lose precision.
      seq: "9007199254740993",
      shopDomain: "example.myshopify.com",
      userId: "9482715",
      name: "wizard_step_saved",
      category: "WIZARD",
      source: "UI",
      // `durationMs` is the client-measured step dwell (usage-analytics P5); optional
      // and best-effort, so consumers must tolerate its absence. Synced byte-for-byte
      // with Badgy's source fixture (server/services/__fixtures__/usageEventsPage.fixture.ts).
      properties: { campaignId: "cmp_1", step: "discount", durationMs: 42000 },
      impersonated: false,
      occurredAt: "2026-07-11T09:14:02.000Z",
    },
    {
      id: "clzabc123def456ghi789pqr",
      seq: "9007199254740994",
      shopDomain: "example.myshopify.com",
      userId: null,
      name: "campaign_activated",
      category: "CAMPAIGN",
      source: "SYSTEM",
      properties: null,
      impersonated: true,
      occurredAt: "2026-07-11T10:00:00.000Z",
    },
  ],
  nextSinceSeq: "9007199254740994",
  hasMore: true,
};

/** The empty/dry-poll response: no new events beyond the cursor. */
export const USAGE_EVENTS_EMPTY_PAGE_FIXTURE: UsageEventPage = {
  events: [],
  nextSinceSeq: "9007199254740994",
  hasMore: false,
};
