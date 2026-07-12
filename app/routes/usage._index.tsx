import { BarList, Card, Grid, LineChart, Text } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";
import { UsagePageShell } from "~/components/usage/UsagePageShell.js";
import { ChartCard } from "~/components/usage/chartChrome.js";
import { StatTiles, type StatTileSpec } from "~/components/usage/StatTiles.js";
import {
  chartNumberFormatter,
  formatPct,
  humanizeEventName,
} from "~/components/usage/usageLabels.js";

/**
 * Usage overview (`/usage`, usage-analytics Phase 4). Snapshot-sourced: stat tiles (WAU,
 * MAU, stickiness = DAU/MAU, events/day, median time-to-first-campaign — the last is
 * deferred), the active-shops (WAU) trend over ≥12 weeks where data exists, the most-
 * performed actions, and an activation funnel derived from the latest cohort lifecycle
 * distribution. Every number comes from `trpc.usage.overview` (UsageMetricDaily /
 * KpiSnapshot / UsageCohortSnapshot) — no raw-event aggregation at request time.
 */
export default function UsageOverview() {
  const q = trpc.usage.overview.useQuery();
  const data = q.data;

  const tiles: StatTileSpec[] = [
    { key: "wau", label: "Weekly active shops", value: data?.tiles.find((t) => t.key === "wau")?.value ?? null },
    { key: "mau", label: "Monthly active shops", value: data?.tiles.find((t) => t.key === "mau")?.value ?? null },
    stickinessTile(data?.tiles.find((t) => t.key === "stickiness")?.value ?? null),
    { key: "eventsPerDay", label: "Events / day", value: data?.tiles.find((t) => t.key === "eventsPerDay")?.value ?? null },
    {
      key: "medianTimeToFirstCampaign",
      label: "Median time-to-first-campaign",
      value: null,
      deferred: true,
    },
  ];

  const trend = (data?.activeShops ?? []).map((p) => ({
    date: p.date,
    "Weekly active shops": p.value,
    provisional: p.provisional,
  }));

  const topActions = (data?.topActions ?? []).map((a) => ({
    name: humanizeEventName(a.name),
    value: a.value,
  }));

  const funnel = (data?.activationFunnel ?? []).map((s) => ({ name: s.name, value: s.value }));
  const funnelHasData = funnel.some((s) => s.value > 0);

  return (
    <UsagePageShell
      title="Overview"
      description="Product-usage health for the selected app. All figures are snapshot-sourced."
      asOf={data?.asOf}
      showProvisionalNote={trend.length > 0}
    >
      {q.isLoading ? (
        <Card role="status" aria-busy="true">
          <Text className="text-tremor-content-subtle">Loading overview…</Text>
        </Card>
      ) : q.isError ? (
        <Card role="alert" aria-label="Overview load error">
          <Text>Couldn't load the usage overview.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">{q.error.message}</Text>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <StatTiles tiles={tiles} />

          <ChartCard
            title="Active shops"
            subtitle="Weekly active shops (trailing 7 days), daily"
            isEmpty={trend.length === 0}
            collectingSince={data?.collectingSince}
            asOf={data?.asOf}
            ariaLabel="Active shops trend"
          >
            <LineChart
              className="mt-2 h-72"
              data={trend}
              index="date"
              categories={["Weekly active shops"]}
              colors={["blue"]}
              valueFormatter={chartNumberFormatter}
              showAnimation={false}
              yAxisWidth={44}
              noDataText="Collecting data…"
            />
          </ChartCard>

          <Grid numItemsLg={2} className="gap-4">
            <ChartCard
              title="Top actions"
              subtitle="Most-performed actions on the latest finalized day"
              isEmpty={topActions.length === 0}
              collectingSince={data?.collectingSince}
              asOf={data?.asOf}
              ariaLabel="Top actions"
            >
              <BarList data={topActions} className="mt-2" valueFormatter={chartNumberFormatter} />
            </ChartCard>

            <ChartCard
              title="Activation funnel"
              subtitle="Shops by lifecycle stage (from the latest cohort snapshot)"
              isEmpty={!funnelHasData}
              collectingSince={data?.collectingSince}
              asOf={data?.asOf}
              ariaLabel="Activation funnel"
            >
              <BarList data={funnel} className="mt-2" color="emerald" valueFormatter={chartNumberFormatter} />
              <Text className="mt-3 text-xs text-tremor-content-subtle">
                Derived from cohort lifecycle labels. A literal install→embed→wizard→
                campaign event funnel needs signals Phase 3 does not yet emit.
              </Text>
            </ChartCard>
          </Grid>
        </div>
      )}
    </UsagePageShell>
  );
}

/** Stickiness tile with a formatted percentage display. */
function stickinessTile(value: number | null): StatTileSpec {
  return {
    key: "stickiness",
    label: "Stickiness (DAU/MAU)",
    value,
    display: value === null ? undefined : formatPct(value),
  };
}
