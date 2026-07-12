import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { Flex, Text, Title } from "@tremor/react";
import { AsOf, ProvisionalNote } from "./chartChrome.js";

/**
 * Common frame for the four usage pages (usage-analytics Phase 4): the section title, a
 * sub-nav linking the sibling views, the shared "as of" freshness stamp, and (opt-in) the
 * provisional-today legend. Keeps every usage page visually consistent and the house-rule
 * freshness stamp present on all of them.
 */

const USAGE_TABS: ReadonlyArray<{ readonly to: string; readonly label: string; readonly end?: boolean }> = [
  { to: "/usage", label: "Overview", end: true },
  { to: "/usage/features", label: "Features" },
  { to: "/usage/funnel", label: "Funnel" },
  { to: "/usage/shops", label: "Shops" },
  // ADMIN-only alert-rule management (P5). Server enforces `usage_alerts:manage`; the tab
  // is cosmetic and a non-ADMIN who follows it sees the access-required card.
  { to: "/usage/alerts", label: "Alerts" },
];

export function UsagePageShell({
  title,
  description,
  asOf,
  showProvisionalNote = false,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly asOf?: string | null;
  readonly showProvisionalNote?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <main className="p-6" aria-label={`Usage — ${title}`}>
      <Flex justifyContent="between" alignItems="baseline" className="mb-1 gap-4">
        <Title>Usage · {title}</Title>
        {asOf !== undefined ? <AsOf iso={asOf ?? null} /> : null}
      </Flex>
      {description ? (
        <Text className="mb-3 text-tremor-content-subtle">{description}</Text>
      ) : null}

      <nav aria-label="Usage views" className="mb-5 flex flex-wrap gap-1 border-b border-tremor-border">
        {USAGE_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end ?? false}
            className={({ isActive }) =>
              [
                "-mb-px border-b-2 px-3 py-2 text-sm",
                isActive
                  ? "border-tremor-brand text-tremor-brand"
                  : "border-transparent text-tremor-content hover:text-tremor-content-emphasis",
              ].join(" ")
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {showProvisionalNote ? (
        <div className="mb-4">
          <ProvisionalNote />
        </div>
      ) : null}

      {children}
    </main>
  );
}
