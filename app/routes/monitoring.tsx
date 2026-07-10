import { Card, Text, Title, Flex, Grid, Metric, Badge } from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

/**
 * Portfolio health / monitoring dashboard (cp-ops-monitoring). `ops:view`-gated.
 * Per-queue tiles (backlog, failures, worker liveness) + webhook/compliance gauges +
 * a Sentry error-rate reference, with the live `generatedAt` as the "as of" marker.
 */

type Snapshot = inferRouterOutputs<AppRouter>["monitoring"]["tiles"];
type QueueTile = Snapshot["queues"][number];

function livenessColor(l: QueueTile["liveness"]): "emerald" | "gray" | "red" {
  return l === "healthy" ? "emerald" : l === "idle" ? "gray" : "red";
}

function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleString();
}

export default function Monitoring() {
  const tilesQuery = trpc.monitoring.tiles.useQuery(undefined, {
    // Live ops data — refresh on an interval so the tiles track reality. No-input
    // query: don't auto-retry (FORBIDDEN is detected at render time below).
    refetchInterval: 15_000,
    retry: false,
  });

  if (tilesQuery.error?.data?.code === "FORBIDDEN") {
    return (
      <main className="apoaap-monitoring p-6" aria-label="Monitoring">
        <Title>Portfolio health</Title>
        <Card className="mt-4" role="alert" aria-label="Monitoring access denied">
          <Text className="font-medium">Ops access required</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            This view needs the <code>ops:view</code> permission.
          </Text>
        </Card>
      </main>
    );
  }

  const snap = tilesQuery.data;

  return (
    <main className="apoaap-monitoring p-6" aria-label="Monitoring">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Portfolio health</Title>
        {snap ? (
          <Text className="text-xs text-tremor-content-subtle">
            as of{" "}
            <time dateTime={snap.generatedAt}>{formatTimestamp(snap.generatedAt)}</time>
          </Text>
        ) : null}
      </Flex>

      {tilesQuery.isLoading ? (
        <Text role="status">Loading monitoring…</Text>
      ) : !snap ? (
        <Card>
          <Text role="alert">Couldn't load monitoring data.</Text>
        </Card>
      ) : (
        <>
          <Text className="apoaap-section-label mb-2">Queues</Text>
          <Grid numItemsMd={2} numItemsLg={3} className="gap-4">
            {snap.queues.map((q) => (
              <Card key={q.name} aria-label={`queue ${q.name}`}>
                <Flex justifyContent="between" alignItems="start">
                  <Text className="font-medium">{q.name}</Text>
                  <Badge color={livenessColor(q.liveness)} aria-label={`liveness ${q.liveness}`}>
                    {q.liveness}
                  </Badge>
                </Flex>
                <Flex justifyContent="between" className="mt-3">
                  <div>
                    <Text className="text-xs text-tremor-content-subtle">Backlog</Text>
                    <Metric className="text-xl">{q.backlog}</Metric>
                  </div>
                  <div>
                    <Text className="text-xs text-tremor-content-subtle">Failed</Text>
                    <Metric className="text-xl">{q.failed}</Metric>
                  </div>
                  <div>
                    <Text className="text-xs text-tremor-content-subtle">Completed</Text>
                    <Metric className="text-xl">{q.completed}</Metric>
                  </div>
                </Flex>
              </Card>
            ))}
          </Grid>

          <Text className="apoaap-section-label mb-2 mt-6">Reliability</Text>
          <Grid numItemsMd={2} numItemsLg={4} className="gap-4">
            <Card aria-label="webhook failures">
              <Text className="text-xs text-tremor-content-subtle">Webhooks failing</Text>
              <Metric>{snap.gauges.webhookFailed}</Metric>
            </Card>
            <Card aria-label="webhook dead letters">
              <Text className="text-xs text-tremor-content-subtle">Dead-lettered</Text>
              <Metric>{snap.gauges.webhookDeadLetter}</Metric>
            </Card>
            <Card aria-label="compliance breaching">
              <Text className="text-xs text-tremor-content-subtle">DSR breaching</Text>
              <Metric>{snap.gauges.complianceBreaching}</Metric>
            </Card>
            <Card aria-label="error monitoring">
              <Text className="text-xs text-tremor-content-subtle">Error rate</Text>
              <Text className="mt-2 text-sm">
                Tracked in{" "}
                <a href="https://sentry.io" target="_blank" rel="noreferrer">
                  Sentry
                </a>
              </Text>
            </Card>
          </Grid>
        </>
      )}
    </main>
  );
}
