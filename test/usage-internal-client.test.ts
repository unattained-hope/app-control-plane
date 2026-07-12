// test/usage-internal-client.test.ts
// The signed client must reproduce Badgy's internalAuth scheme EXACTLY, or every
// request fails Badgy's guard. These tests pin the canonical base string, the
// HMAC, and the header set against independent computations — a drift here is a
// silent production outage, so it must break a test.
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildSignatureBase,
  signRequest,
  buildSignedGetHeaders,
  SaleSwitchInternalClient,
  BADGY_SIGNATURE_HEADER,
  BADGY_TIMESTAMP_HEADER,
  BADGY_NONCE_HEADER,
} from "~/server/connectors/saleswitchInternalClient.js";
import { USAGE_EVENTS_PAGE_FIXTURE } from "./fixtures/usageEventsPage.fixture.js";

describe("saleswitchInternalClient signing", () => {
  it("builds the canonical base exactly as Badgy: `${ts}.${METHOD}.${pathname}.${body}`", () => {
    expect(buildSignatureBase("1720000000000", "get", "/internal/v1/events", "")).toBe(
      "1720000000000.GET./internal/v1/events.",
    );
  });

  it("signs with HMAC-SHA256 hex — matches an independent computation", () => {
    const secret = "shared-secret";
    const base = "1720000000000.GET./internal/v1/events.";
    const expected = createHmac("sha256", secret).update(base).digest("hex");
    expect(signRequest(secret, base)).toBe(expected);
    // sanity: hex, 64 chars
    expect(signRequest(secret, base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("emits the three Badgy headers with a matching signature", () => {
    const secret = "shared-secret";
    const now = 1_720_000_000_000;
    const headers = buildSignedGetHeaders(secret, "/internal/v1/events", now, "nonce-1");
    const expectedSig = createHmac("sha256", secret)
      .update(`${now}.GET./internal/v1/events.`)
      .digest("hex");
    expect(headers[BADGY_SIGNATURE_HEADER]).toBe(expectedSig);
    expect(headers[BADGY_TIMESTAMP_HEADER]).toBe(String(now)); // epoch MS
    expect(headers[BADGY_NONCE_HEADER]).toBe("nonce-1");
  });
});

describe("SaleSwitchInternalClient.fetchUsageEvents", () => {
  function makeClient(fetchImpl: typeof fetch) {
    return new SaleSwitchInternalClient({
      baseUrl: "https://badgy.example.com/",
      secret: "shared-secret",
      fetchImpl,
      now: () => 1_720_000_000_000,
      nonce: () => "fixed-nonce",
    });
  }

  it("signs the PATHNAME only (no query) and appends the params to the URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify(USAGE_EVENTS_PAGE_FIXTURE), { status: 200 });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    const page = await client.fetchUsageEvents({ sinceSeq: 5n, limit: 200 });

    // trailing slash on baseUrl trimmed; query carries the cursor + limit.
    expect(capturedUrl).toBe(
      "https://badgy.example.com/internal/v1/events?sinceSeq=5&limit=200",
    );
    // The signature covers ONLY the pathname — recompute and compare.
    const expectedSig = createHmac("sha256", "shared-secret")
      .update(`1720000000000.GET./internal/v1/events.`)
      .digest("hex");
    expect(capturedHeaders[BADGY_SIGNATURE_HEADER]).toBe(expectedSig);
    // The page passes through unchanged (seq stays a string).
    expect(page).toEqual(USAGE_EVENTS_PAGE_FIXTURE);
    expect(typeof page.events[0]?.seq).toBe("string");
  });

  it("serializes a large BigInt cursor without precision loss", async () => {
    let capturedUrl = "";
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ events: [], nextSinceSeq: "0", hasMore: false }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await client.fetchUsageEvents({ sinceSeq: 9007199254740993n, limit: 200 });
    expect(capturedUrl).toContain("sinceSeq=9007199254740993");
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await expect(client.fetchUsageEvents({ sinceSeq: 0n, limit: 200 })).rejects.toThrow(/HTTP 401/);
  });

  it("uses a fresh nonce+timestamp per request", async () => {
    const seen: (string | undefined)[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seen.push(h[BADGY_NONCE_HEADER]);
      return new Response(JSON.stringify({ events: [], nextSinceSeq: "0", hasMore: false }), { status: 200 });
    }) as unknown as typeof fetch;
    // real nonce generator (not the fixed stub)
    const client = new SaleSwitchInternalClient({
      baseUrl: "https://badgy.example.com",
      secret: "s",
      fetchImpl,
    });
    await client.fetchUsageEvents({ sinceSeq: 0n, limit: 10 });
    await client.fetchUsageEvents({ sinceSeq: 0n, limit: 10 });
    expect(seen[0]).not.toBe(seen[1]);
  });
});
