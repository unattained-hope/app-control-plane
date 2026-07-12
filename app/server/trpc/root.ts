import { router } from "./core.js";
import type { Context } from "./core.js";
import { resolveIdentity } from "../auth.js";
import { resolveDevIdentity } from "../devSession.js";
import { directoryRouter } from "./routers/directory.js";
import { actionsRouter } from "./routers/actions.js";
import { auditRouter } from "./routers/audit.js";
import { billingRouter } from "./routers/billing.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { chatRouter } from "./routers/chat.js";
import { cannedRouter } from "./routers/canned.js";
import { routingRouter } from "./routers/routing.js";
import { appRouter_ } from "./routers/app.js";
import { complianceRouter } from "./routers/compliance.js";
import { webhooksRouter } from "./routers/webhooks.js";
import { monitoringRouter } from "./routers/monitoring.js";
import { breakGlassRouter } from "./routers/breakGlass.js";
import { healthRouter } from "./routers/health.js";
import { flagsRouter } from "./routers/flags.js";
import { announcementsRouter } from "./routers/announcements.js";
import { plansRouter } from "./routers/plans.js";
import { badgeGraphicsRouter } from "./routers/badgeGraphics.js";
import { usageRouter } from "./routers/usage.js";
import { usageManagementRouter } from "./routers/usageManagement.js";

/** The single tRPC root router — end-to-end typed first-party API. */
export const appRouter = router({
  directory: directoryRouter,
  actions: actionsRouter,
  audit: auditRouter,
  billing: billingRouter,
  dashboard: dashboardRouter,
  chat: chatRouter,
  canned: cannedRouter,
  routing: routingRouter,
  app: appRouter_,
  compliance: complianceRouter,
  // Tier 2 — scale-readiness / ops resilience.
  webhooks: webhooksRouter,
  monitoring: monitoringRouter,
  breakGlass: breakGlassRouter,
  // Tier 3 — growth & retention.
  health: healthRouter,
  flags: flagsRouter,
  announcements: announcementsRouter,
  plans: plansRouter,
  badgeGraphics: badgeGraphicsRouter,
  // usage-analytics Phase 4 — usage dashboards (read-only, snapshot-sourced).
  usage: usageRouter,
  // usage-analytics Phase 5 — alert-rule management (ADMIN) + per-admin saved views.
  usageManagement: usageManagementRouter,
});

export type AppRouter = typeof appRouter;

const DEFAULT_APP_KEY = "saleswitch";

/** Build the request-scoped tRPC context from an incoming Request. */
export async function createContext(req: Request): Promise<Context> {
  // Dev cookie session (gated to development) takes precedence so browser tests
  // can exercise real RBAC; production resolves identity only via WorkOS.
  const identity =
    (await resolveDevIdentity(req.headers)) ?? (await resolveIdentity(req.headers));
  const url = new URL(req.url);
  const appKey = url.searchParams.get("app") ?? DEFAULT_APP_KEY;
  return {
    identity,
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
    appKey,
  };
}
