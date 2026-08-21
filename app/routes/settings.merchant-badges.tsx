import { Link } from "react-router";
import { Card, Text, Title } from "@tremor/react";
import { Award } from "lucide-react";

/** Placeholder for per-merchant BadgeTemplate management (cp-app-settings phase 2). */
export default function SettingsMerchantBadges() {
  return (
    <main className="apoaap-settings p-6" aria-label="Merchant badges settings">
      <Link to="/settings" className="text-sm text-tremor-content-subtle hover:underline">
        ← Settings
      </Link>
      <Title className="mt-2 flex items-center gap-2">
        <Award className="h-5 w-5 text-tremor-brand" aria-hidden="true" />
        <span>Merchant badges</span>
      </Title>
      <Card className="mt-4" role="status">
        <Text className="font-medium">Coming soon</Text>
        <Text className="mt-2 text-sm text-tremor-content-subtle">
          Per-shop badge template management will list merchant-saved designs via the
          app connector and dispatch dangerous actions through the SaleSwitch admin API.
        </Text>
      </Card>
    </main>
  );
}
