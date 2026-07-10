import { useMemo, useState } from "react";
import { Card, Text, Title, Flex, Badge, Button } from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

/**
 * Failed-delivery view (cp-webhook-reliability). Lists FAILED / DEAD_LETTER Shopify
 * webhook events for the selected app, server-paginated. ADMIN operators get a
 * Replay button that re-enqueues a dead-lettered event (audited `webhook.replayed`).
 * `ops:view`-gated server-side; a non-`ops:view` role gets FORBIDDEN, surfaced here
 * as an explicit message.
 */

type DeliveryRow = inferRouterOutputs<AppRouter>["webhooks"]["list"][number];

const PAGE_SIZE = 25;

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleString();
}

function statusColor(status: DeliveryRow["status"]): "amber" | "red" {
  return status === "DEAD_LETTER" ? "red" : "amber";
}

export default function WebhookDeliveries() {
  const [page, setPage] = useState(1);

  const listQuery = trpc.webhooks.list.useQuery(
    { page, pageSize: PAGE_SIZE },
    {
      retry: (failureCount, error) =>
        error.data?.code === "FORBIDDEN" ? false : failureCount < 1,
    },
  );
  const utils = trpc.useUtils();
  const replay = trpc.webhooks.replay.useMutation({
    onSuccess: () => utils.webhooks.list.invalidate(),
  });

  const isForbidden = listQuery.error?.data?.code === "FORBIDDEN";
  const rows: readonly DeliveryRow[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  if (isForbidden) {
    return (
      <main className="apoaap-webhooks p-6" aria-label="Webhook deliveries">
        <Title>Failed webhook deliveries</Title>
        <Card className="mt-4" role="alert" aria-label="Webhook deliveries access denied">
          <Text className="font-medium">Ops access required</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            This view needs the <code>ops:view</code> permission.
          </Text>
        </Card>
      </main>
    );
  }

  return (
    <main className="apoaap-webhooks p-6" aria-label="Webhook deliveries">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Failed webhook deliveries</Title>
        <Text className="text-xs text-tremor-content-subtle">
          FAILED retries automatically; DEAD_LETTER needs a manual replay.
        </Text>
      </Flex>

      <Card>
        <div aria-busy={listQuery.isLoading || listQuery.isFetching}>
          <table className="apoaap-audit-table" aria-label="Failed webhook deliveries">
            <thead>
              <tr>
                <th scope="col" className="apoaap-audit-th">When</th>
                <th scope="col" className="apoaap-audit-th">Topic</th>
                <th scope="col" className="apoaap-audit-th">Shop</th>
                <th scope="col" className="apoaap-audit-th">Status</th>
                <th scope="col" className="apoaap-audit-th">Attempts</th>
                <th scope="col" className="apoaap-audit-th">Last error</th>
                <th scope="col" className="apoaap-audit-th">Action</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="apoaap-audit-td-state">
                    <Text role="status">Loading deliveries…</Text>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="apoaap-audit-td-state">
                    <Text role="status" aria-label="No failed deliveries">
                      No failed or dead-lettered deliveries. 🎉
                    </Text>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="apoaap-audit-tr">
                    <td className="apoaap-audit-td">{formatTimestamp(r.receivedAt)}</td>
                    <td className="apoaap-audit-td"><code>{r.topic}</code></td>
                    <td className="apoaap-audit-td">{r.shop ?? "—"}</td>
                    <td className="apoaap-audit-td">
                      <Badge color={statusColor(r.status)} aria-label={`status ${r.status}`}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="apoaap-audit-td">{r.attempts}</td>
                    <td className="apoaap-audit-td" title={r.error ?? ""}>
                      {r.error ?? "—"}
                    </td>
                    <td className="apoaap-audit-td">
                      {r.status === "DEAD_LETTER" ? (
                        <Button
                          size="xs"
                          variant="secondary"
                          aria-label={`Replay ${r.id}`}
                          loading={replay.isPending && replay.variables?.id === r.id}
                          onClick={() => replay.mutate({ id: r.id })}
                        >
                          Replay
                        </Button>
                      ) : (
                        <Text className="text-xs text-tremor-content-subtle">retrying…</Text>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Flex justifyContent="between" alignItems="center" className="mt-4">
        <Text className="text-xs text-tremor-content-subtle">
          {replay.isError ? `Replay failed: ${replay.error.message}` : `Page ${page}`}
        </Text>
        <Flex justifyContent="end" className="gap-2">
          <Button
            size="xs"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="xs"
            variant="secondary"
            disabled={rows.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </Flex>
      </Flex>
    </main>
  );
}
