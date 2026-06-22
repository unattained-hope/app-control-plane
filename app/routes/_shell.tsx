import { NavLink, Outlet } from "react-router";
import { trpc } from "~/lib/trpc.js";

/**
 * AppShell layout (cp-app-shell). Renders the global chrome shared by every
 * authed route: a header with the top-bar app selector (cp-app-registry-connector,
 * SaleSwitch-only in MVP), the primary nav, and the routed `<Outlet/>`.
 *
 * This is a layout route — it owns no page data. Server-side RBAC is enforced in
 * tRPC; the nav here is cosmetic navigation only.
 */
export default function AppShell() {
  return (
    <div className="apoaap-shell">
      <header className="apoaap-shell-header">
        <div className="apoaap-shell-brand">
          <span className="apoaap-shell-logo" aria-hidden="true">
            ◆
          </span>
          <span className="apoaap-shell-title">Apoaap Control Plane</span>
        </div>
        <AppSelector />
      </header>

      <div className="apoaap-shell-body">
        <nav className="apoaap-shell-nav" aria-label="Primary">
          <ul>
            {NAV_ITEMS.map((item) => (
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
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="apoaap-shell-main" id="main-content">
          <Outlet />
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
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/merchants", label: "Merchants" },
  { to: "/inbox", label: "Inbox" },
  { to: "/audit", label: "Audit" },
];

/**
 * Top-bar app selector (cp-app-registry-connector). Lists the apps the operator
 * may pivot between. In MVP this resolves to SaleSwitch only, so the control is
 * rendered as a single-option select that is informative rather than interactive.
 */
function AppSelector() {
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
        aria-label="Select app"
        defaultValue={apps[0]?.key}
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
