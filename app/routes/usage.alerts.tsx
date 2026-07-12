import { useMemo, useState } from "react";
import { Badge, Button, Card, NumberInput, Text, Title } from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";
import { UsagePageShell } from "~/components/usage/UsagePageShell.js";

/**
 * Usage alert-rule admin UI (`/usage/alerts`, usage-analytics Phase 5). `usage_alerts:manage`
 * (ADMIN) server-side — a non-ADMIN gets FORBIDDEN, surfaced here. Manage the threshold-rule
 * registry that the alert-evaluation job reads: enable/disable each rule and edit its
 * threshold. Rules are seeded DISABLED; an enabled rule fires ONCE per breach episode (plus a
 * recovery notice) on finalized week-over-week numbers. Every change is audited server-side.
 */

type AlertRule = inferRouterOutputs<AppRouter>["usageManagement"]["alertRules"]["list"][number];

const METRIC_KIND_LABEL: Readonly<Record<string, string>> = {
  METRIC_WOW_POINTS: "Δ points WoW",
  METRIC_WOW_PERCENT: "Δ % WoW",
  COHORT_TRANSITION: "cohort entries WoW",
};
const COMPARISON_LABEL: Readonly<Record<string, string>> = {
  DROP_GT: "drop >",
  RISE_GT: "rise >",
};

/** Format a threshold for its metric kind (percent kinds render as %). */
function formatThreshold(rule: AlertRule): string {
  if (rule.metricKind === "METRIC_WOW_PERCENT") return `${(rule.threshold * 100).toFixed(1)}%`;
  if (rule.metricKind === "COHORT_TRANSITION") return `${rule.threshold} shops`;
  return `${rule.threshold}`;
}

export default function UsageAlerts() {
  const listQuery = trpc.usageManagement.alertRules.list.useQuery(undefined, {
    retry: (failureCount: number, error: { data?: { code?: string } | null }) =>
      error.data?.code === "FORBIDDEN" ? false : failureCount < 1,
  });
  const utils = trpc.useUtils();
  const invalidate = () => utils.usageManagement.alertRules.list.invalidate();

  const setEnabled = trpc.usageManagement.alertRules.setEnabled.useMutation({ onSuccess: invalidate });
  const update = trpc.usageManagement.alertRules.update.useMutation({ onSuccess: invalidate });

  const isForbidden = listQuery.error?.data?.code === "FORBIDDEN";
  const rules: readonly AlertRule[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  // Local threshold-edit buffer keyed by rule id (only the row being edited).
  const [editing, setEditing] = useState<{ id: string; value: number } | null>(null);

  if (isForbidden) {
    return (
      <UsagePageShell
        title="Alerts"
        description="Threshold alerts over usage metrics — enable rules and tune thresholds."
        asOf={null}
      >
        <Card role="alert" aria-label="Usage alerts access denied">
          <Text className="font-medium">Admin access required</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            This view needs the <code>usage_alerts:manage</code> permission.
          </Text>
        </Card>
      </UsagePageShell>
    );
  }

  return (
    <UsagePageShell
      title="Alerts"
      description="Threshold alerts over the pre-rolled usage metrics. Rules fire once per breach episode on finalized week-over-week numbers."
      asOf={null}
    >
      <Card>
        <div
          className="apoaap-callout-note mb-4 px-3 py-2"
          role="note"
          aria-label="How alert rules work"
        >
          <Text className="text-xs text-cp-note-text">
            Rules are seeded disabled. Enable one to start evaluating it after each daily
            finalization; an enabled rule alerts once when it breaches and once when it
            recovers. Thresholds are editable here without a redeploy.
          </Text>
        </div>

        <table className="apoaap-audit-table" aria-label="Usage alert rules">
          <thead>
            <tr>
              <th scope="col" className="apoaap-audit-th">Rule</th>
              <th scope="col" className="apoaap-audit-th">Metric</th>
              <th scope="col" className="apoaap-audit-th">Condition</th>
              <th scope="col" className="apoaap-audit-th">Threshold</th>
              <th scope="col" className="apoaap-audit-th">Status</th>
              <th scope="col" className="apoaap-audit-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="apoaap-audit-td-state">
                  <Text role="status">Loading rules…</Text>
                </td>
              </tr>
            ) : rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="apoaap-audit-td-state">
                  <Text role="status">No alert rules yet — seed them with `npm run seed`.</Text>
                </td>
              </tr>
            ) : (
              rules.map((r) => {
                const isEditing = editing?.id === r.id;
                return (
                  <tr key={r.id} className="apoaap-audit-tr">
                    <td className="apoaap-audit-td">
                      <div className="font-medium">{r.label}</div>
                      <code className="text-xs text-tremor-content-subtle">{r.key}</code>
                    </td>
                    <td className="apoaap-audit-td">
                      <code>{r.dimension ? `${r.metric} [${r.dimension}]` : r.metric}</code>
                      <div className="text-xs text-tremor-content-subtle">
                        {METRIC_KIND_LABEL[r.metricKind] ?? r.metricKind}
                      </div>
                    </td>
                    <td className="apoaap-audit-td">{COMPARISON_LABEL[r.comparison] ?? r.comparison}</td>
                    <td className="apoaap-audit-td">
                      {isEditing ? (
                        <div className="w-28">
                          <NumberInput
                            value={editing!.value}
                            onValueChange={(v) => setEditing({ id: r.id, value: Number(v) })}
                            step={0.01}
                            aria-label={`Threshold for ${r.label}`}
                          />
                        </div>
                      ) : (
                        formatThreshold(r)
                      )}
                    </td>
                    <td className="apoaap-audit-td">
                      <Badge color={r.enabled ? "emerald" : "gray"}>
                        {r.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </td>
                    <td className="apoaap-audit-td">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.label}`}
                          loading={setEnabled.isPending && setEnabled.variables?.id === r.id}
                          onClick={() => setEnabled.mutate({ id: r.id, enabled: !r.enabled })}
                        >
                          {r.enabled ? "Disable" : "Enable"}
                        </Button>
                        {isEditing ? (
                          <>
                            <Button
                              size="xs"
                              aria-label={`Save threshold for ${r.label}`}
                              loading={update.isPending}
                              onClick={() => {
                                update.mutate(
                                  { id: r.id, threshold: editing!.value },
                                  { onSuccess: () => setEditing(null) },
                                );
                              }}
                            >
                              Save
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              aria-label={`Cancel editing ${r.label}`}
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="xs"
                            variant="light"
                            aria-label={`Edit threshold for ${r.label}`}
                            onClick={() => setEditing({ id: r.id, value: r.threshold })}
                          >
                            Edit threshold
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {update.isError ? (
          <Text className="mt-2 text-xs text-cp-danger" role="alert">
            {update.error.message}
          </Text>
        ) : null}
      </Card>
    </UsagePageShell>
  );
}
