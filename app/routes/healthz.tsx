/**
 * Liveness probe (cp-status-synthetics). Returns 200 while the process is up — no
 * dependency checks, no data. Unauthenticated by design (exposes only up/down). The
 * bought public status page + the synthetic monitor poll this.
 */
export function loader() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
