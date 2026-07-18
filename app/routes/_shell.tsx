import {
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import { authkitLoader } from "@workos-inc/authkit-react-router";
import type { Role } from "@prisma/client";
import { trpc } from "~/lib/trpc.js";
import { getConfig } from "~/lib/config.js";
import {
  ensureAuthKitConfigured,
  getWorkOs,
  resolveIdentity,
} from "~/server/auth.js";
import { resolveDevIdentity } from "~/server/devSession.js";
import { ThemeToggle } from "~/components/ThemeToggle.js";
import { useAppContext } from "~/lib/appContext.js";
import { AgentChatSocketProvider } from "~/lib/agentChatSocket.js";

export interface ShellOutletContext {
  readonly role: Role;
  readonly userId: string;
  readonly agentName: string;
}

/**
 * Auth gate for every shell-wrapped (authed) route. Without a resolved identity
 * the whole app would otherwise render a dead UNAUTHORIZED screen with no way in,
 * since tRPC rejects every procedure. So bounce unauthenticated requests to a
 * sign-in path BEFORE rendering: in dev to the role switcher (default ADMIN, the
 * fullest-access role for local work), in prod to the WorkOS sign-in URL. The
 * e2e suite always visits `/dev-login` first, so it already carries the cookie
 * and this redirect never fires for it.
 *
 * Production uses authkitLoader so expired access tokens are refreshed and the
 * sealed session cookie is rewritten on the response.
 */
export async function loader(args: LoaderFunctionArgs) {
  const { request } = args;

  const devIdentity = await resolveDevIdentity(request.headers);
  if (devIdentity) {
    return {
      role: devIdentity.role,
      userId: devIdentity.id,
      agentName: devIdentity.name ?? devIdentity.email,
    };
  }

  if (getConfig().NODE_ENV === "development") {
    const identity = await resolveIdentity(request.headers);
    if (identity) {
      return {
        role: identity.role,
        userId: identity.id,
        agentName: identity.name ?? identity.email,
      };
    }
    const url = new URL(request.url);
    const dest = encodeURIComponent(url.pathname + url.search);
    throw redirect(`/dev-login?role=ADMIN&to=${dest}`);
  }

  ensureAuthKitConfigured();
  return authkitLoader(args, async ({ request: req, auth }) => {
    if (!auth.user) {
      const url = new URL(req.url);
      throw redirect(await getWorkOs().signInUrl(url.pathname + url.search));
    }
    const identity = await resolveIdentity(req.headers);
    if (!identity) {
      throw redirect(await getWorkOs().signInUrl());
    }
    return {
      role: identity.role,
      userId: identity.id,
      agentName: identity.name ?? identity.email,
    };
  });
}

/**
 * AppShell layout (cp-app-shell). Renders the global chrome shared by every
 * authed route: a header with the top-bar app selector (cp-app-registry-connector,
 * SaleSwitch-only in MVP), the primary nav, and the routed `<Outlet/>`.
 *
 * This is a layout route — it owns no page data. Server-side RBAC is enforced in
 * tRPC; the nav here is cosmetic navigation only.
 */
export default function AppShell() {
  const data = useLoaderData() as { role: Role; userId: string; agentName: string } | null;
  const role = data?.role ?? "VIEWER";
  const userId = data?.userId;
  const agentName = data?.agentName ?? "Support";
  const { appKey } = useAppContext();
  const unreadQuery = trpc.chat.unreadTotal.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const unreadTotal = unreadQuery.data ?? 0;
  // The active app's enabled modules gate module-scoped nav sections (e.g. "usage"),
  // consistent with the multi-app seam: an app without usage ingestion simply doesn't
  // show the section. Cosmetic only — the tRPC procedures still enforce access.
  const appsQuery = trpc.app.apps.useQuery();
  const enabledModules =
    appsQuery.data?.find((a) => a.key === appKey)?.enabledModules ?? [];
  const navItems = NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || role === "ADMIN") &&
      (!item.module || enabledModules.includes(item.module)),
  );

  return (
    <div className="apoaap-shell">
      <header className="apoaap-shell-header">
        <div className="apoaap-shell-brand">
          <span className="apoaap-shell-logo" aria-hidden="true">
            ◆
          </span>
          <span className="apoaap-shell-title">Apoaap Control Plane</span>
        </div>
        <div className="apoaap-shell-header-actions">
          <ThemeToggle />
          <AppSelector />
          <span className="apoaap-role-badge" title="Your role">
            {role}
          </span>
        </div>
      </header>

      <div className="apoaap-shell-body">
        <nav className="apoaap-shell-nav" aria-label="Primary">
          <ul>
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end ?? false}
                  className={({ isActive }) =>
                    isActive
                      ? "apoaap-nav-link is-active"
                      : "apoaap-nav-link"
                  }
                >
                  <span className="apoaap-nav-link-inner">
                    <span>{item.label}</span>
                    {item.to === "/inbox" && unreadTotal > 0 ? (
                      <span
                        className="apoaap-nav-badge"
                        aria-label={`${unreadTotal} unread messages`}
                      >
                        {unreadTotal > 99 ? "99+" : unreadTotal}
                      </span>
                    ) : null}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="apoaap-shell-main" id="main-content">
          <AgentChatSocketProvider
            userId={userId}
            role={role}
            appKey={appKey}
            agentName={agentName}
          >
            <Outlet
              context={{
                role,
                userId: userId ?? "",
                agentName,
              } satisfies ShellOutletContext}
            />
          </AgentChatSocketProvider>
        </main>
      </div>
    </div>
  );
}

interface NavItem {
  readonly to: string;
  readonly label: string;
  /** `end` matches the route exactly — used for the index ("/") route. */
  readonly end?: boolean;
  /** Only show to ADMIN (cosmetic; the route's procedures enforce server-side). */
  readonly adminOnly?: boolean;
  /** Only show when the active app has this module in its registry `enabledModules`. */
  readonly module?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/merchants", label: "Merchants" },
  { to: "/inbox", label: "Inbox" },
  { to: "/routing-rules", label: "Routing", adminOnly: true },
  { to: "/audit", label: "Audit" },
  { to: "/compliance", label: "Compliance", adminOnly: true },
  // Tier 3 — growth & retention.
  { to: "/at-risk", label: "At-risk" },
  // usage-analytics Phase 4 — module-gated on the app registry's "usage" module.
  { to: "/usage", label: "Usage", module: "usage" },
  { to: "/feature-flags", label: "Flags", adminOnly: true },
  { to: "/announcements", label: "Announcements", adminOnly: true },
  { to: "/settings", label: "Settings", adminOnly: true },
];

/**
 * Top-bar app selector (cp-app-registry-connector). Lists the apps the operator
 * may pivot between. In MVP this resolves to SaleSwitch only, so the control is
 * rendered as a single-option select that is informative rather than interactive.
 */
function AppSelector() {
  const { appKey, setAppKey } = useAppContext();
  const appsQuery = trpc.app.apps.useQuery();

  if (appsQuery.isLoading) {
    return (
      <div className="apoaap-app-selector" aria-busy="true">
        <span className="apoaap-app-selector-label">Loading apps…</span>
      </div>
    );
  }

  if (appsQuery.isError) {
    return (
      <div className="apoaap-app-selector" role="alert">
        <span className="apoaap-app-selector-label">
          Unable to load apps
        </span>
      </div>
    );
  }

  const apps = appsQuery.data ?? [];

  if (apps.length === 0) {
    return (
      <div className="apoaap-app-selector">
        <span className="apoaap-app-selector-label">No apps</span>
      </div>
    );
  }

  return (
    <div className="apoaap-app-selector">
      <label htmlFor="apoaap-app-select" className="apoaap-app-selector-label">
        App
      </label>
      <select
        id="apoaap-app-select"
        className="apoaap-app-select"
        aria-label="Select app"
        value={appKey}
        onChange={(e) => setAppKey(e.target.value)}
        disabled={apps.length === 1}
      >
        {apps.map((app) => (
          <option key={app.key} value={app.key}>
            {app.name}
          </option>
        ))}
      </select>
    </div>
  );
}
