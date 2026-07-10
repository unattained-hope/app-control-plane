import { useMemo } from "react";
import { Card, Text, Title, Flex, Badge } from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

/**
 * At-risk merchants (cp-merchant-health). Ranks shops by health band
 * (CRITICAL → AT_RISK → HEALTHY) then risk score, reading the latest pre-aggregated
 * `MerchantHealthSnapshot` per shop — never a live join. `view`-gated server-side.
 */

type HealthRow = inferRouterOutputs<AppRouter>["health"]["atRisk"][number];

const BAND_TONE: Readonly<Record<string, "emerald" | "amber" | "rose">> = {
  HEALTHY: "emerald",
  AT_RISK: "amber",
  CRITICAL: "rose",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleString();
}

export default function AtRisk() {
  const atRiskQuery = trpc.health.atRisk.useQuery();
  const rows: readonly HealthRow[] = useMemo(() => atRiskQuery.data ?? [], [atRiskQuery.data]);

  return (
    <main className="apoaap-at-risk p-6" aria-label="At-risk merchants">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>At-risk merchants</Title>
        <Text className="text-xs text-tremor-content-subtle">
          Ranked by health band, worst first. Scored by the growth rollup.
        </Text>
      </Flex>

      <Card>
        <div aria-busy={atRiskQuery.isLoading}>
          <table className="apoaap-audit-table" aria-label="At-risk merchants">
            <thead>
              <tr>
                <th scope="col" className="apoaap-audit-th">Shop</th>
                <th scope="col" className="apoaap-audit-th">Band</th>
                <th scope="col" className="apoaap-audit-th">Risk score</th>
                <th scope="col" className="apoaap-audit-th">Top factors</th>
                <th scope="col" className="apoaap-audit-th">As of</th>
              </tr>
            </thead>
            <tbody>
              {atRiskQuery.isLoading ? (
                <tr>
                  <td colSpan={5} className="apoaap-audit-td-state">
                    <Text role="status">Loading health…</Text>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="apoaap-audit-td-state">
                    <Text role="status" aria-label="No scored merchants">
                      No merchants scored yet.
                    </Text>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.shop} className="apoaap-audit-tr">
                    <td className="apoaap-audit-td">
                      <a href={`/merchants/${r.shop}`} className="text-tremor-brand hover:underline">
                        {r.shop}
                      </a>
                    </td>
                    <td className="apoaap-audit-td">
                      <Badge color={BAND_TONE[r.band] ?? "gray"} aria-label={`band ${r.band}`}>
                        {r.band}
                      </Badge>
                    </td>
                    <td className="apoaap-audit-td">{r.score}</td>
                    <td className="apoaap-audit-td">
                      {r.factors.length === 0
                        ? "—"
                        : r.factors.map((f) => f.key).join(", ")}
                    </td>
                    <td className="apoaap-audit-td">
                      <time dateTime={r.asOf}>{formatTimestamp(r.asOf)}</time>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
