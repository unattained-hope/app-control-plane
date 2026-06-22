import { Card, Metric, Text, Title, Flex, BarList, Grid } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";

/**
 * KPI dashboard (cp-kpi-dashboard). Reads ONLY the pre-aggregated
 * `trpc.dashboard.kpis` snapshot query — no live joins. Each card surfaces the
 * metric value AND the snapshot's `asOf` timestamp. Metrics with no snapshot
 * render an explicit placeholder/empty state.
 */

interface KpiValue {
  readonly metric: string;
  readonly value: number;
  readonly asOf: string; // ISO
}

const SCALAR_CARDS: ReadonlyArray<{ readonly metric: string; readonly label: string }> = [
  { metric: "active_merchants", label: "Active merchants" },
  { metric: "new_installs_7d", label: "New installs (7d)" },
  { metric: "new_installs_30d", label: "New installs (30d)" },
  { metric: "uninstalls", label: "Uninstalls" },
  { metric: "mrr", label: "MRR" },
];

/** Build a metric-keyed lookup so each card finds its own snapshot (or none). */
function indexByMetric(rows: readonly KpiValue[]): ReadonlyMap<string, KpiValue> {
  const map = new Map<string, KpiValue>();
  for (const row of rows) map.set(row.metric, row);
  return map;
}

/** Render an ISO snapshot time as a stable, locale-aware "as of" label. */
function formatAsOf(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

/** MRR is stored in whole currency units; everything else is a plain count. */
function formatValue(metric: string, value: number): string {
  if (metric === "mrr") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat().format(value);
}

function AsOf({ iso }: { readonly iso: string }) {
  return (
    <Text className="mt-2 text-xs">
      as of <time dateTime={iso}>{formatAsOf(iso)}</time>
    </Text>
  );
}

function ScalarCard({
  label,
  metric,
  snapshot,
}: {
  readonly label: string;
  readonly metric: string;
  readonly snapshot: KpiValue | undefined;
}) {
  return (
    <Card aria-label={`${label} KPI`}>
      <Text>{label}</Text>
      {snapshot ? (
        <>
          <Metric aria-label={`${label} value`}>
            {formatValue(metric, snapshot.value)}
          </Metric>
          <AsOf iso={snapshot.asOf} />
        </>
      ) : (
        <PlaceholderBody label={label} />
      )}
    </Card>
  );
}

function PlaceholderBody({ label }: { readonly label: string }) {
  return (
    <div role="status" aria-label={`${label} has no snapshot`}>
      <Metric className="text-tremor-content-subtle">—</Metric>
      <Text className="mt-2 text-xs text-tremor-content-subtle">No snapshot yet</Text>
    </div>
  );
}

/**
 * Plan distribution card. The snapshot value is a single pre-aggregated number,
 * so until per-plan breakdown snapshots exist this renders a BarList placeholder
 * carrying the snapshot total + its `asOf` (or an empty state when absent).
 */
function PlanDistributionCard({ snapshot }: { readonly snapshot: KpiValue | undefined }) {
  const label = "Plan distribution";
  return (
    <Card aria-label={`${label} KPI`}>
      <Title>{label}</Title>
      {snapshot ? (
        <>
          <Text className="mt-1">
            {formatValue("plan_distribution", snapshot.value)} on a paid plan
          </Text>
          <BarList
            className="mt-4"
            aria-label="Plan distribution breakdown (placeholder)"
            data={[
              {
                name: "Paid plans (total)",
                value: snapshot.value,
              },
            ]}
          />
          <AsOf iso={snapshot.asOf} />
        </>
      ) : (
        <PlaceholderBody label={label} />
      )}
    </Card>
  );
}

export default function Dashboard() {
  const kpis = trpc.dashboard.kpis.useQuery();

  if (kpis.isLoading) {
    return (
      <main aria-busy="true" className="p-6">
        <Title>KPI dashboard</Title>
        <Text className="mt-2" role="status">
          Loading KPIs…
        </Text>
      </main>
    );
  }

  if (kpis.isError) {
    return (
      <main className="p-6">
        <Title>KPI dashboard</Title>
        <Card className="mt-4" role="alert" aria-label="KPI load error">
          <Text>Couldn't load KPI snapshots.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            {kpis.error.message}
          </Text>
        </Card>
      </main>
    );
  }

  const byMetric = indexByMetric(kpis.data ?? []);

  return (
    <main className="p-6" aria-label="KPI dashboard">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>KPI dashboard</Title>
        <Text className="text-xs text-tremor-content-subtle">
          Snapshot-sourced — no live joins
        </Text>
      </Flex>

      <Grid numItemsSm={2} numItemsLg={3} className="gap-4">
        {SCALAR_CARDS.map((card) => (
          <ScalarCard
            key={card.metric}
            label={card.label}
            metric={card.metric}
            snapshot={byMetric.get(card.metric)}
          />
        ))}
        <PlanDistributionCard snapshot={byMetric.get("plan_distribution")} />
      </Grid>
    </main>
  );
}
