import { useState } from "react";
import { BarList, Card, Grid, Select, SelectItem, Text } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";
import { UsagePageShell } from "~/components/usage/UsagePageShell.js";
import { ChartCard } from "~/components/usage/chartChrome.js";
import {
  FUNNEL_STAGE_LABEL,
  LIFECYCLE_META,
  chartNumberFormatter,
  formatDurationMs,
  formatPct,
  humanizeEventName,
} from "~/components/usage/usageLabels.js";

/**
 * Wizard funnel (`/usage/funnel`, usage-analytics Phase 4 + P5). Step-by-step conversion
 * (shops reaching each stage + step-over-step conversion), the most frequent validation-
 * failure rules, and the median dwell per step (Phase-5 beacon). All from
 * `trpc.usage.funnel` (UsageMetricDaily) — snapshot-sourced.
 *
 * Median dwell per step is now REAL: Badgy's `wizard_step_saved` carries a client-measured
 * `durationMs`, which Phase 3 rolls into `usage.funnel.dwell` (p50 per step). When a step
 * has no dwell data yet (early history) the chart shows the shared empty-state — never the
 * old "coming soon" placeholder.
 *
 * One honest gap remains, surfaced explicitly rather than faked:
 *  • Plan/lifecycle SLICING is a display affordance until Phase 3 pre-rolls segment-
 *    dimensioned funnel metrics; picking a non-"All" segment shows a "coming soon" note
 *    rather than silently returning the unsegmented numbers.
 */

const LIFECYCLE_OPTIONS = ["ALL", ...Object.keys(LIFECYCLE_META)] as const;
// Plan options are illustrative until a plan-dimensioned funnel metric exists.
const PLAN_OPTIONS = ["ALL", "FREE", "STARTER", "GROWTH", "PRO"] as const;

export default function UsageFunnel() {
  const q = trpc.usage.funnel.useQuery();
  const data = q.data;
  const [plan, setPlan] = useState<string>("ALL");
  const [lifecycle, setLifecycle] = useState<string>("ALL");
  const segmented = plan !== "ALL" || lifecycle !== "ALL";

  const stageBars = (data?.stages ?? []).map((s) => ({
    name: FUNNEL_STAGE_LABEL[s.stage] ?? s.stage,
    value: s.shops,
    conv: s.conversionFromStart,
    step: s.conversionFromPrev,
  }));
  const stagesHaveData = stageBars.some((s) => s.value > 0);

  const rules = (data?.topValidationRules ?? []).map((r) => ({
    name: humanizeEventName(r.name),
    value: r.value,
  }));

  // Median dwell per step (Phase-5 beacon). BarList wants a numeric `value`; the label
  // carries the human duration so the bar and the readout agree.
  const dwellBars = (data?.stepDwell ?? []).map((d) => ({
    name: FUNNEL_STAGE_LABEL[d.stage] ?? d.stage,
    value: d.medianMs,
  }));
  const dwellHasData = dwellBars.length > 0;

  // The biggest single-step drop-off, to name the leak up front.
  const leak = findLeak(data?.stages ?? []);

  return (
    <UsagePageShell
      title="Funnel"
      description="Where the campaign wizard leaks — stage conversion and the rules that block completion."
      asOf={data?.asOf}
    >
      {q.isLoading ? (
        <Card role="status" aria-busy="true">
          <Text className="text-tremor-content-subtle">Loading funnel…</Text>
        </Card>
      ) : q.isError ? (
        <Card role="alert" aria-label="Funnel load error">
          <Text>Couldn't load the wizard funnel.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">{q.error.message}</Text>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card aria-label="Funnel slicers">
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-44">
                <Text className="mb-1 text-xs text-tremor-content-subtle">Plan</Text>
                <Select value={plan} onValueChange={setPlan} aria-label="Filter by plan">
                  {PLAN_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p === "ALL" ? "All plans" : p}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="w-44">
                <Text className="mb-1 text-xs text-tremor-content-subtle">Lifecycle</Text>
                <Select value={lifecycle} onValueChange={setLifecycle} aria-label="Filter by lifecycle">
                  {LIFECYCLE_OPTIONS.map((lc) => (
                    <SelectItem key={lc} value={lc}>
                      {lc === "ALL" ? "All lifecycles" : LIFECYCLE_META[lc]?.label ?? lc}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              {leak && !segmented ? (
                <Text className="text-sm text-tremor-content-subtle" role="status">
                  Biggest drop-off: <span className="font-medium text-tremor-content-emphasis">
                    {FUNNEL_STAGE_LABEL[leak.from] ?? leak.from} → {FUNNEL_STAGE_LABEL[leak.to] ?? leak.to}
                  </span>{" "}
                  ({formatPct(1 - leak.retained)} lost)
                </Text>
              ) : null}
            </div>
            {segmented ? (
              <div
                role="status"
                aria-label="Segment slicing not yet available"
                className="apoaap-callout-note mt-3 px-3 py-2"
              >
                <Text className="text-xs text-cp-note-text">
                  Segment-sliced funnels are coming soon — Phase 3 pre-rolls the overall
                  funnel today; a plan/lifecycle-dimensioned metric will make these filters
                  live. Showing the unsegmented funnel below.
                </Text>
              </div>
            ) : null}
          </Card>

          <ChartCard
            title="Wizard step conversion"
            subtitle="Distinct shops reaching each stage (summed over the observed range)"
            isEmpty={!stagesHaveData}
            collectingSince={data?.collectingSince}
            asOf={data?.asOf}
            ariaLabel="Wizard step conversion"
          >
            <BarList data={stageBars} className="mt-2" color="blue" valueFormatter={chartNumberFormatter} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm" aria-label="Stage conversion table">
                <thead>
                  <tr className="text-left text-tremor-content-subtle">
                    <th className="py-1 pr-4 font-medium">Stage</th>
                    <th className="py-1 pr-4 font-medium">Shops</th>
                    <th className="py-1 pr-4 font-medium">From start</th>
                    <th className="py-1 font-medium">Step</th>
                  </tr>
                </thead>
                <tbody>
                  {stageBars.map((s) => (
                    <tr key={s.name} className="border-t border-tremor-border">
                      <td className="py-1 pr-4">{s.name}</td>
                      <td className="py-1 pr-4">{chartNumberFormatter(s.value)}</td>
                      <td className="py-1 pr-4">{formatPct(s.conv)}</td>
                      <td className="py-1">{formatPct(s.step)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <Grid numItemsLg={2} className="gap-4">
            <ChartCard
              title="Top validation failures"
              subtitle="Rules that most often block wizard completion"
              isEmpty={rules.length === 0}
              collectingSince={data?.collectingSince}
              asOf={data?.asOf}
              ariaLabel="Top validation failures"
            >
              <BarList data={rules} className="mt-2" color="rose" valueFormatter={chartNumberFormatter} />
            </ChartCard>

            <ChartCard
              title="Median dwell per step"
              subtitle="Typical time a shop spends on each wizard step (p50, newest day)"
              isEmpty={!dwellHasData}
              collectingSince={data?.collectingSince}
              asOf={data?.asOf}
              ariaLabel="Median dwell per step"
            >
              <BarList
                data={dwellBars}
                className="mt-2"
                color="violet"
                valueFormatter={formatDurationMs}
              />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm" aria-label="Median dwell table">
                  <thead>
                    <tr className="text-left text-tremor-content-subtle">
                      <th className="py-1 pr-4 font-medium">Step</th>
                      <th className="py-1 font-medium">Median dwell</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dwellBars.map((d) => (
                      <tr key={d.name} className="border-t border-tremor-border">
                        <td className="py-1 pr-4">{d.name}</td>
                        <td className="py-1">{formatDurationMs(d.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </Grid>
        </div>
      )}
    </UsagePageShell>
  );
}

/** Find the stage transition with the largest relative drop (smallest retained fraction). */
function findLeak(
  stages: ReadonlyArray<{ readonly stage: string; readonly shops: number; readonly conversionFromPrev: number }>,
): { readonly from: string; readonly to: string; readonly retained: number } | null {
  let worst: { from: string; to: string; retained: number } | null = null;
  for (let i = 1; i < stages.length; i += 1) {
    const prev = stages[i - 1]!;
    const cur = stages[i]!;
    if (prev.shops <= 0) continue;
    const retained = cur.conversionFromPrev;
    if (worst === null || retained < worst.retained) {
      worst = { from: prev.stage, to: cur.stage, retained };
    }
  }
  return worst;
}
