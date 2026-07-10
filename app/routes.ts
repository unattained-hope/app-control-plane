import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

/**
 * Route map. Every authed route renders under the AppShell layout (top-bar app
 * selector + nav). Server-side RBAC is enforced in tRPC; UI gating is cosmetic.
 */
export default [
  // tRPC HTTP endpoint (resource route): client useQuery/useMutation hit this.
  route("trpc/*", "routes/trpc.$.tsx"),
  // Shopify webhook ingestion (resource route, action-only): HMAC-verified,
  // idempotent, fast-200 + BullMQ fan-out (cp-webhook-ingestion).
  route("webhooks/shopify", "routes/webhooks.shopify.tsx"),
  // Ops resource routes (cp-ops-monitoring / cp-status-synthetics). Token-guarded
  // Prometheus scrape + unauthenticated liveness/readiness probes. No UI, no shell.
  route("metrics", "routes/metrics.tsx"),
  route("healthz", "routes/healthz.tsx"),
  route("readyz", "routes/readyz.tsx"),
  // Tier 3 merchant-facing resource routes (cp-feature-flags / cp-self-serve-billing).
  // Token/shop-token authenticated, no UI, no shell — the app/widget consumes these.
  route("api/flags", "routes/api.flags.tsx"),
  route("api/self-serve-billing", "routes/api.self-serve-billing.tsx"),
  // Dev-only role switcher (sets the cp_dev_role cookie). Inert in production.
  route("dev-login", "routes/dev-login.tsx"),
  layout("routes/_shell.tsx", [
    index("routes/dashboard.tsx"),
    route("merchants", "routes/merchants.tsx"),
    route("merchants/:shop", "routes/merchant-detail.tsx"),
    route("inbox", "routes/inbox.tsx"),
    route("routing-rules", "routes/routing-rules.tsx"),
    route("audit", "routes/audit.tsx"),
    route("compliance", "routes/compliance.tsx"),
    // Tier 2 — scale-readiness / ops resilience.
    route("monitoring", "routes/monitoring.tsx"),
    route("webhook-deliveries", "routes/webhook-deliveries.tsx"),
    route("break-glass", "routes/break-glass.tsx"),
    // Tier 3 — growth & retention.
    route("at-risk", "routes/at-risk.tsx"),
    route("feature-flags", "routes/feature-flags.tsx"),
    route("announcements", "routes/announcements.tsx"),
    route("plan-requests", "routes/plan-requests.tsx"),
  ]),
] satisfies RouteConfig;
