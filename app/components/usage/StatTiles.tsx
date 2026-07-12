import { Card, Grid, Metric, Text } from "@tremor/react";

/**
 * A row of headline stat tiles for the usage overview (usage-analytics Phase 4). Each
 * tile shows a value or, when the metric is absent, an em dash placeholder — and, when a
 * metric is intentionally not yet produced by Phase 3 (deferred), a "coming soon" note
 * instead of a fake number. Snapshot-sourced, so there is nothing live here.
 */

export interface StatTileSpec {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  /** Pre-formatted display value (e.g. a percentage). Falls back to the raw number. */
  readonly display?: string;
  /** Deferred = the metric isn't collected yet; render "coming soon", not a value. */
  readonly deferred?: boolean;
  /** Optional one-line helper under the value. */
  readonly hint?: string;
}

export function StatTiles({ tiles }: { readonly tiles: readonly StatTileSpec[] }) {
  return (
    <Grid numItemsSm={2} numItemsLg={5} className="gap-4">
      {tiles.map((t) => (
        <Card key={t.key} aria-label={`${t.label} stat`}>
          <Text>{t.label}</Text>
          {t.deferred ? (
            <div role="status" aria-label={`${t.label} not yet collected`}>
              <Metric className="text-tremor-content-subtle">—</Metric>
              <Text className="mt-1 text-xs text-tremor-content-subtle">Coming soon</Text>
            </div>
          ) : t.value === null ? (
            <div role="status" aria-label={`${t.label} has no snapshot`}>
              <Metric className="text-tremor-content-subtle">—</Metric>
              <Text className="mt-1 text-xs text-tremor-content-subtle">No data yet</Text>
            </div>
          ) : (
            <>
              <Metric aria-label={`${t.label} value`}>
                {t.display ?? new Intl.NumberFormat().format(t.value)}
              </Metric>
              {t.hint ? (
                <Text className="mt-1 text-xs text-tremor-content-subtle">{t.hint}</Text>
              ) : null}
            </>
          )}
        </Card>
      ))}
    </Grid>
  );
}
