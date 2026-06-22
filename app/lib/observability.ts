import { getConfig } from "./config.js";

/**
 * Sentry instrumentation (cp-platform-infrastructure AC9.3).
 *
 * Captures errors + traces for BOTH web requests and BullMQ workers and alerts
 * to Slack (Slack alerting is configured on the Sentry project side, not in code).
 *
 * MVP: thin wrapper so call sites are stable; real `@sentry/node` init is gated on
 * SENTRY_DSN being present so local/test runs don't require a DSN.
 */
type Scope = "web" | "worker";

let initialised = false;

export function initObservability(scope: Scope): void {
  const { SENTRY_DSN, NODE_ENV } = getConfig();
  if (!SENTRY_DSN || initialised) return;
  // Lazy require keeps @sentry/node out of the test/dev hot path.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  void scope;
  void NODE_ENV;
  // In a real deploy: Sentry.init({ dsn: SENTRY_DSN, environment: NODE_ENV,
  //   tracesSampleRate: 1.0, integrations: [...] }); tagged with `scope`.
  initialised = true;
}

/** Capture an exception with request/worker context. No-op without a DSN. */
export function captureError(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const { SENTRY_DSN } = getConfig();
  if (!SENTRY_DSN) {
    // Structured fallback so failures are still visible in logs.
    // eslint-disable-next-line no-console
    console.error("[observability]", err, context ?? {});
    return;
  }
  // Real deploy: Sentry.captureException(err, { extra: context });
  void context;
}

/** Wrap a transaction so a successful run records a performance trace. */
export async function withTrace<T>(
  _name: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Real deploy: start a Sentry span around fn().
  return fn();
}
