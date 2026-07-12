import { Link } from "react-router";
import { Card, Text, Title } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";
import { useAppContext } from "~/lib/appContext.js";

/**
 * App settings hub (cp-app-settings). Shows module cards for the active app based
 * on `enabledModules` in the app registry.
 */
export default function SettingsIndex() {
  const { appKey } = useAppContext();
  const appsQuery = trpc.app.apps.useQuery();
  const app = appsQuery.data?.find((a) => a.key === appKey);
  const modules = app?.enabledModules ?? [];

  const hasSettings = modules.includes("settings");

  return (
    <main className="apoaap-settings p-6" aria-label="App settings">
      <Title>Settings</Title>
      <Text className="mt-1 text-sm text-tremor-content-subtle">
        App-specific configuration for {app?.name ?? appKey}.
      </Text>

      {!hasSettings ? (
        <Card className="mt-4" role="status">
          <Text>No settings modules are enabled for this app.</Text>
        </Card>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="apoaap-settings-card">
            <Title className="text-base">Badge graphics</Title>
            <Text className="mt-2 text-sm text-tremor-content-subtle">
              Manage the built-in IMAGE badge gallery — add, categorize, archive, and set
              the default graphic merchants see on first Image badge pick.
            </Text>
            <Link
              to="/settings/badge-graphics"
              className="apoaap-btn apoaap-btn-primary mt-4 inline-block"
            >
              Manage gallery
            </Link>
          </Card>

          <Card className="apoaap-settings-card opacity-75">
            <Title className="text-base">Merchant badges</Title>
            <Text className="mt-2 text-sm text-tremor-content-subtle">
              Per-shop saved badge templates (read/manage via connector — coming soon).
            </Text>
            <Link
              to="/settings/merchant-badges"
              className="apoaap-btn mt-4 inline-block"
            >
              View placeholder
            </Link>
          </Card>
        </div>
      )}
    </main>
  );
}
