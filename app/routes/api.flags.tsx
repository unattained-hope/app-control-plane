import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { getConfig } from "~/lib/config.js";
import { getFeatureFlagService } from "~/server/services/featureFlagService.js";

/**
 * Narrow feature-flag read endpoint (cp-feature-flags) as an RR7 resource route. The
 * SaleSwitch app PULLS its per-shop flag evaluations from here; the control plane never
 * writes flags into the app DB. Guarded by a `FEATURE_FLAGS_READ_TOKEN` bearer IN
 * ADDITION to the zero-trust gateway (the app authenticates by token, not SSO).
 * Fail-closed: an unset token refuses every request. Returns only `{ [flag]: boolean }`
 * for the requested shop — no PII, no other shops.
 */

const DEFAULT_APP_KEY = "saleswitch";

/** Constant-time bearer compare; false on any length mismatch (never throws). */
function tokenMatches(presented: string, expected: string): boolean {
  if (!expected) return false; // unset token => no access at all (fail-closed)
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const cfg = getConfig();
  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!tokenMatches(presented, cfg.FEATURE_FLAGS_READ_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return Response.json({ error: "shop is required" }, { status: 400 });
  }
  const appKey = url.searchParams.get("app") ?? DEFAULT_APP_KEY;
  const flags = await getFeatureFlagService().evaluateForShop(appKey, shop);
  return Response.json({ appKey, shop, flags });
}
