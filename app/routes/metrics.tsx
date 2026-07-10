import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { getConfig } from "~/lib/config.js";
import { getOpsMetricsService } from "~/server/services/opsMetricsService.js";

/**
 * Prometheus scrape endpoint (cp-ops-monitoring) as an RR7 resource route. Guarded
 * by a `METRICS_AUTH_TOKEN` bearer token IN ADDITION to the zero-trust gateway —
 * scrapers authenticate by token, not SSO. Fail-closed: an unset token refuses every
 * request. Emits BullMQ `bullmq_job_count{queue,state}` + control-plane gauges; NO PII.
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
  if (!tokenMatches(presented, cfg.METRICS_AUTH_TOKEN)) {
    return new Response("unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const appKey = url.searchParams.get("app") ?? DEFAULT_APP_KEY;
  const body = await getOpsMetricsService().prometheus(appKey);
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
