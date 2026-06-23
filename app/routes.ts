import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

/**
 * Route map. Every authed route renders under the AppShell layout (top-bar app
 * selector + nav). Server-side RBAC is enforced in tRPC; UI gating is cosmetic.
 */
export default [
  // tRPC HTTP endpoint (resource route): client useQuery/useMutation hit this.
  route("trpc/*", "routes/trpc.$.tsx"),
  // Dev-only role switcher (sets the cp_dev_role cookie). Inert in production.
  route("dev-login", "routes/dev-login.tsx"),
  layout("routes/_shell.tsx", [
    index("routes/dashboard.tsx"),
    route("merchants", "routes/merchants.tsx"),
    route("merchants/:shop", "routes/merchant-detail.tsx"),
    route("inbox", "routes/inbox.tsx"),
    route("audit", "routes/audit.tsx"),
  ]),
] satisfies RouteConfig;
