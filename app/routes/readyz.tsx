import { checkReadiness, readinessResponse } from "~/lib/readiness.js";

/**
 * Readiness probe (cp-status-synthetics). 200 only when the control-plane DB AND
 * Redis are reachable; 503 otherwise so an orchestrator stops routing traffic here.
 * Unauthenticated — the body is an up/down status object only, never any data.
 */
export async function loader() {
  const result = await checkReadiness();
  const { status, body } = readinessResponse(result);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
