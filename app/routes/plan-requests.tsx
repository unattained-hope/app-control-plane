import { useMemo } from "react";
import { Card, Text, Title, Flex, Badge } from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

/**
 * Plan-change requests (cp-self-serve-billing). `view`-gated read of merchant-initiated
 * plan changes and their status (REQUESTED → DISPATCHED/FAILED, or a ticket fallback).
 * The control plane never mutates billing — these are dispatched to the app admin API.
 */

type PlanRow = inferRouterOutputs<AppRouter>["plans"]["requests"][number];

const STATUS_TONE: Readonly<Record<string, "amber" | "emerald" | "rose" | "gray">> = {
  REQUESTED: "amber",
  DISPATCHED: "emerald",
  COMPLETED: "emerald",
  FAILED: "rose",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleString();
}

export default function PlanRequests() {
  const query = trpc.plans.requests.useQuery();
  const rows: readonly PlanRow[] = useMemo(() => query.data ?? [], [query.data]);

  return (
    <main className="apoaap-plan-requests p-6" aria-label="Plan change requests">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Plan change requests</Title>
        <Text className="text-xs text-tremor-content-subtle">
          Merchant self-serve requests, dispatched to the app admin API.
        </Text>
      </Flex>

      <Card>
        <div aria-busy={query.isLoading}>
          <table className="apoaap-audit-table" aria-label="Plan change requests">
            <thead>
              <tr>
                <th scope="col" className="apoaap-audit-th">When</th>
                <th scope="col" className="apoaap-audit-th">Shop</th>
                <th scope="col" className="apoaap-audit-th">From → To</th>
                <th scope="col" className="apoaap-audit-th">Status</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td colSpan={4} className="apoaap-audit-td-state">
                    <Text role="status">Loading requests…</Text>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="apoaap-audit-td-state">
                    <Text role="status">No plan change requests.</Text>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="apoaap-audit-tr">
                    <td className="apoaap-audit-td">{formatTimestamp(r.createdAt)}</td>
                    <td className="apoaap-audit-td">{r.shop}</td>
                    <td className="apoaap-audit-td">
                      {(r.fromPlan ?? "—")} → {r.toPlan}
                    </td>
                    <td className="apoaap-audit-td">
                      <Badge color={STATUS_TONE[r.status] ?? "gray"} aria-label={`status ${r.status}`}>
                        {r.status}
                      </Badge>
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
