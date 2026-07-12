// app/server/connectors/saleswitchInternalClient.ts
// Signed HTTP client for Badgy's internal AppMonitorContract API (usage-analytics
// Phase 2b). This is the control plane's FIRST outbound HMAC-signed call — no
// signing machinery existed before. It reproduces Badgy's shipped scheme
// (server/lib/internalAuth.ts) EXACTLY:
//
//   base      = `${timestampMs}.${METHOD}.${pathname}.${rawBody}`   (pathname
//               only, no query string; empty body for GET)
//   signature = HMAC-SHA256(secret, base) as lowercase hex
//   headers   = x-badgy-signature, x-badgy-timestamp (epoch ms), x-badgy-nonce
//
// A drift in any of these fails Badgy's guard, so the pieces are pure + unit-
// tested against a known vector. Fail-closed: with no URL or secret configured,
// the caller (connector) skips ingestion rather than issue an unsigned request.

import { createHmac, randomUUID } from "node:crypto";
import { getConfig } from "~/lib/config.js";
import { getSecretsManager, SALESWITCH_INTERNAL_API_REF } from "~/lib/secrets.js";
import type { UsageEventPage } from "./types.js";

// Header names — must match Badgy's shared/constants.ts INTERNAL_API_*_HEADER.
export const BADGY_SIGNATURE_HEADER = "x-badgy-signature";
export const BADGY_TIMESTAMP_HEADER = "x-badgy-timestamp";
export const BADGY_NONCE_HEADER = "x-badgy-nonce";

/** The canonical string Badgy signs. Kept identical to buildInternalSignatureBase. */
export function buildSignatureBase(
  timestampMs: string,
  method: string,
  pathname: string,
  rawBody: string,
): string {
  return `${timestampMs}.${method.toUpperCase()}.${pathname}.${rawBody}`;
}

/** HMAC-SHA256 hex signature over a canonical base. */
export function signRequest(secret: string, base: string): string {
  return createHmac("sha256", secret).update(base).digest("hex");
}

/** Build the three auth headers for a GET (empty body) to `pathname`. */
export function buildSignedGetHeaders(
  secret: string,
  pathname: string,
  now: number,
  nonce: string,
): Record<string, string> {
  const timestampMs = String(now);
  const base = buildSignatureBase(timestampMs, "GET", pathname, "");
  return {
    [BADGY_SIGNATURE_HEADER]: signRequest(secret, base),
    [BADGY_TIMESTAMP_HEADER]: timestampMs,
    [BADGY_NONCE_HEADER]: nonce,
  };
}

const USAGE_EVENTS_PATH = "/internal/v1/events";

/** Injectable seams so tests don't touch the network, clock, or crypto RNG. */
export interface SaleSwitchInternalClientDeps {
  readonly baseUrl: string;
  readonly secret: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly nonce?: () => string;
}

/**
 * A minimal signed client bound to one app's base URL + secret. Only the usage-
 * events pull is implemented (the sole Phase-2b need).
 */
export class SaleSwitchInternalClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly nonce: () => string;

  constructor(deps: SaleSwitchInternalClientDeps) {
    // Trim a trailing slash so `${baseUrl}${pathname}` never doubles it.
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.secret = deps.secret;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? Date.now;
    this.nonce = deps.nonce ?? randomUUID;
  }

  /**
   * GET /internal/v1/events?sinceSeq=&limit= — one cursor page. `seq`/`nextSinceSeq`
   * arrive as JSON strings and are surfaced unchanged (the ingest layer parses to
   * BigInt at the DB boundary). Throws on a non-2xx response.
   */
  async fetchUsageEvents(args: {
    sinceSeq: bigint;
    limit: number;
  }): Promise<UsageEventPage> {
    // The signature covers the PATHNAME only (no query), matching Badgy's guard.
    const headers = buildSignedGetHeaders(
      this.secret,
      USAGE_EVENTS_PATH,
      this.now(),
      this.nonce(),
    );
    const url = new URL(this.baseUrl + USAGE_EVENTS_PATH);
    url.searchParams.set("sinceSeq", args.sinceSeq.toString());
    url.searchParams.set("limit", String(args.limit));

    const res = await this.fetchImpl(url.toString(), { method: "GET", headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `usage-events fetch failed: HTTP ${res.status} ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as UsageEventPage;
    return json;
  }
}

/**
 * Build a client from config + secrets, or null when ingestion isn't configured
 * (no base URL or no secret) — the connector then omits `fetchUsageEvents` and the
 * worker skips the app. Never returns a client that would sign with an empty secret.
 */
export async function buildSaleSwitchInternalClient(): Promise<SaleSwitchInternalClient | null> {
  const baseUrl = getConfig().SALESWITCH_INTERNAL_API_URL;
  if (!baseUrl) return null;
  const secret = await getSecretsManager().resolveInternalApiSecret(
    SALESWITCH_INTERNAL_API_REF,
  );
  if (!secret) return null;
  return new SaleSwitchInternalClient({ baseUrl, secret });
}
