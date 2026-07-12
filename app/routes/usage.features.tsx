import { useState } from "react";
import { BarList, Card, DonutChart, Grid, LineChart, Tab, TabGroup, TabList, Text } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";
import { UsagePageShell } from "~/components/usage/UsagePageShell.js";
import { ChartCard } from "~/components/usage/chartChrome.js";
import {
  CATEGORICAL_COLORS,
  FEATURE_LABEL,
  chartNumberFormatter,
} from "~/components/usage/usageLabels.js";

/**
 * Feature adoption (`/usage/features`, usage-analytics Phase 4). Per-feature adoption as a
 * percentage of active shops with a 30/90-day window toggle (both windows are pre-rolled,
 * so the toggle re-renders without recomputation), per-feature adoption trend lines, and
 * the mix of discount/campaign types among activated campaigns (Donuts). All from
 * `trpc.usage.features` (UsageMetricDaily) — snapshot-sourced.
 */
export default function UsageFeatures() {
  const q = trpc.usage.features.useQuery();
  const data = q.data;
  const [windowDays, setWindowDays] = useState<30 | 90>(30);

  const adoption = windowDays === 30 ? data?.adoption30 ?? [] : data?.adoption90 ?? [];
  const adoptionBars = adoption
    .map((r) => ({
      name: FEATURE_LABEL[r.feature] ?? r.feature,
      value: Math.round(r.pct * 1000) / 10, // percentage, 1 decimal
      shops: r.shops,
      activeShops: r.activeShops,
    }))
    .sort((a, b) => b.value - a.value);
  const adoptionHasData = adoption.some((r) => r.activeShops > 0);

  // Per-feature D30 trend: fold each feature's series into one wide row set keyed by date.
  const trendFeatures = (data?.featureTrends ?? []).filter((t) => t.points.length > 0);
  const trendRows = buildWideTrend(trendFeatures);
  const trendCategories = trendFeatures.map((t) => FEATURE_LABEL[t.feature] ?? t.feature);

  const discountMix = (data?.discountTypeMix ?? []).map((d) => ({ name: d.name, value: d.value }));
  const campaignMix = (data?.campaignTypeMix ?? []).map((d) => ({ name: d.name, value: d.value }));

  return (
    <UsagePageShell
      title="Features"
      description="Which features earn their keep, as a share of active shops."
      asOf={data?.asOf}
    >
      {q.isLoading ? (
        <Card role="status" aria-busy="true">
          <Text className="text-tremor-content-subtle">Loading feature adoption…</Text>
        </Card>
      ) : q.isError ? (
        <Card role="alert" aria-label="Features load error">
          <Text>Couldn't load feature adoption.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">{q.error.message}</Text>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <ChartCard
            title="Feature adoption"
            subtitle={`Distinct shops using each feature, as % of active shops (${windowDays}-day window)`}
            isEmpty={!adoptionHasData}
            collectingSince={data?.collectingSince}
            asOf={data?.asOf}
            ariaLabel="Feature adoption"
            actions={
              <TabGroup
                index={windowDays === 30 ? 0 : 1}
                onIndexChange={(i) => setWindowDays(i === 0 ? 30 : 90)}
              >
                <TabList variant="solid" aria-label="Adoption window">
                  <Tab>30-day</Tab>
                  <Tab>90-day</Tab>
                </TabList>
              </TabGroup>
            }
          >
            <BarList
              data={adoptionBars}
              className="mt-2"
              color="blue"
              valueFormatter={(v: number) => `${v}%`}
            />
            <Text className="mt-3 text-xs text-tremor-content-subtle">
              Percentages are of distinct active shops in the same {windowDays}-day window.
            </Text>
          </ChartCard>

          <ChartCard
            title="Feature adoption trend"
            subtitle="Distinct adopting shops per feature (30-day window), over time"
            isEmpty={trendRows.length === 0}
            collectingSince={data?.collectingSince}
            asOf={data?.asOf}
            ariaLabel="Feature adoption trend"
          >
            <LineChart
              className="mt-2 h-72"
              data={trendRows}
              index="date"
              categories={trendCategories}
              colors={[...CATEGORICAL_COLORS]}
              valueFormatter={chartNumberFormatter}
              showAnimation={false}
              yAxisWidth={44}
              noDataText="Collecting data…"
            />
          </ChartCard>

          <Grid numItemsLg={2} className="gap-4">
            <ChartCard
              title="Discount-type mix"
              subtitle="Among activated campaigns"
              isEmpty={discountMix.length === 0}
              collectingSince={data?.collectingSince}
              asOf={data?.asOf}
              ariaLabel="Discount-type mix"
            >
              <DonutChart
                className="mt-2 h-60"
                data={discountMix}
                category="value"
                index="name"
                colors={[...CATEGORICAL_COLORS]}
                valueFormatter={chartNumberFormatter}
                showAnimation={false}
              />
            </ChartCard>

            <ChartCard
              title="Campaign-type mix"
              subtitle="Among activated campaigns"
              isEmpty={campaignMix.length === 0}
              collectingSince={data?.collectingSince}
              asOf={data?.asOf}
              ariaLabel="Campaign-type mix"
            >
              <DonutChart
                className="mt-2 h-60"
                data={campaignMix}
                category="value"
                index="name"
                colors={[...CATEGORICAL_COLORS]}
                valueFormatter={chartNumberFormatter}
                showAnimation={false}
              />
            </ChartCard>
          </Grid>
          <Text className="text-xs text-tremor-content-subtle">
            Type mixes populate once a dimensioned discount/campaign-type metric is rolled up.
          </Text>
        </div>
      )}
    </UsagePageShell>
  );
}

/**
 * Fold N per-feature series into wide rows keyed by date, one column per feature label,
 * so a single Tremor LineChart can plot every feature. Dates are the union across series;
 * a feature missing a date contributes 0 for that date (a gap on the line).
 */
function buildWideTrend(
  features: ReadonlyArray<{ readonly feature: string; readonly points: ReadonlyArray<{ readonly date: string; readonly value: number }> }>,
): Array<Record<string, string | number>> {
  const byDate = new Map<string, Record<string, string | number>>();
  for (const f of features) {
    const label = FEATURE_LABEL[f.feature] ?? f.feature;
    for (const p of f.points) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[label] = p.value;
      byDate.set(p.date, row);
    }
  }
  // Ensure every feature column exists on every row (0 where absent).
  const labels = features.map((f) => FEATURE_LABEL[f.feature] ?? f.feature);
  const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const row of rows) {
    for (const label of labels) if (!(label in row)) row[label] = 0;
  }
  return rows;
}
