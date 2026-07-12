import type { ReactNode } from "react";
import { Card, Text, Title, Flex } from "@tremor/react";

/**
 * Shared chart chrome for the usage dashboards (usage-analytics Phase 4). Establishes
 * the conventions every usage view copies (design.md Decision 5, "Establish reusable
 * chart wrappers"):
 *   • `AsOf` — the freshness stamp the house rule requires on every view.
 *   • `ProvisionalNote` — the legend explaining the dashed "today is being computed" mark.
 *   • `ChartCard` — one wrapper handling loading / error / empty (pre-data) states so no
 *     page ever looks broken before the rollup has run.
 *   • `DeferredSlot` — an explicit "not yet collected" placeholder for metrics Phase 3
 *     does not (yet) produce (wizard dwell, time-to-first-campaign), so we never fake data.
 *
 * These are theme-agnostic: they lean on Tremor's token-mapped classes
 * (`tremor-content-subtle`, `tremor-brand`, `Card`), which resolve to the control-plane
 * CSS variables in BOTH light and dark (tailwind.config `colors.tremor.*`).
 */

/** Render an ISO timestamp as a stable, locale-aware label (falls back to the raw value). */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

/** Render an ISO date (YYYY-MM-DD or full ISO) as a short date label. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleDateString();
}

/**
 * The "as of" freshness stamp (house rule). Shows the last rollup write; when nothing
 * has been rolled up yet it says so plainly rather than rendering a blank.
 */
export function AsOf({ iso }: { readonly iso: string | null }) {
  if (!iso) {
    return (
      <Text className="text-xs text-tremor-content-subtle">Not yet computed</Text>
    );
  }
  return (
    <Text className="text-xs text-tremor-content-subtle">
      as of <time dateTime={iso}>{formatTimestamp(iso)}</time>
    </Text>
  );
}

/**
 * Legend explaining the provisional-today treatment: the current UTC day's numbers are
 * still being computed by the hourly incremental rollup, so they render dashed/subtle.
 */
export function ProvisionalNote() {
  return (
    <div className="flex items-center gap-2" aria-label="Provisional data legend">
      <span
        aria-hidden="true"
        className="inline-block h-0 w-6 border-t-2 border-dashed border-tremor-content-subtle"
      />
      <Text className="text-xs text-tremor-content-subtle">
        Today is provisional — still being computed
      </Text>
    </div>
  );
}

/**
 * A wrapper for a single chart/section. Handles the four states uniformly:
 *   • loading  → `role="status"` spinner text (aria-busy),
 *   • error    → `role="alert"` with the message,
 *   • empty    → explicit pre-data copy ("Collecting data since …" or "no data yet"),
 *   • ready    → the chart children, with an `asOf` stamp footer.
 *
 * `isEmpty` lets a page declare "the query succeeded but there are no rows to chart yet"
 * so the empty-state copy shows instead of an axis with nothing on it.
 */
export function ChartCard({
  title,
  subtitle,
  isLoading = false,
  isError = false,
  errorMessage,
  isEmpty = false,
  collectingSince,
  asOf,
  actions,
  children,
  ariaLabel,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly errorMessage?: string;
  readonly isEmpty?: boolean;
  readonly collectingSince?: string | null;
  readonly asOf?: string | null;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly ariaLabel?: string;
}) {
  return (
    <Card aria-label={ariaLabel ?? title}>
      <Flex justifyContent="between" alignItems="start" className="gap-3">
        <div className="min-w-0">
          <Title>{title}</Title>
          {subtitle ? (
            <Text className="mt-0.5 text-xs text-tremor-content-subtle">{subtitle}</Text>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </Flex>

      <div className="mt-4">
        {isLoading ? (
          <div role="status" aria-busy="true" className="py-8 text-center">
            <Text className="text-tremor-content-subtle">Loading…</Text>
          </div>
        ) : isError ? (
          <div role="alert" className="py-8 text-center">
            <Text>Couldn't load this data.</Text>
            {errorMessage ? (
              <Text className="mt-1 text-xs text-tremor-content-subtle">{errorMessage}</Text>
            ) : null}
          </div>
        ) : isEmpty ? (
          <EmptyState collectingSince={collectingSince} />
        ) : (
          children
        )}
      </div>

      {!isLoading && !isError && asOf !== undefined ? (
        <div className="mt-4">
          <AsOf iso={asOf ?? null} />
        </div>
      ) : null}
    </Card>
  );
}

/** Explicit pre-data empty state — never a broken-looking blank chart. */
export function EmptyState({ collectingSince }: { readonly collectingSince?: string | null }) {
  return (
    <div role="status" className="py-8 text-center">
      <Text className="text-tremor-content-subtle">
        {collectingSince
          ? `Collecting data since ${formatDate(collectingSince)} — charts populate as the rollup runs.`
          : "No usage data yet — this populates once the rollup has run at least once."}
      </Text>
    </div>
  );
}

/**
 * A slot for a metric Phase 3 deliberately does NOT produce yet (wizard step dwell,
 * median time-to-first-campaign). Renders an honest "coming soon" placeholder — the
 * plan is explicit that we render this rather than fabricate or show a broken chart.
 */
export function DeferredSlot({
  title,
  reason,
}: {
  readonly title: string;
  readonly reason: string;
}) {
  return (
    <Card aria-label={`${title} (coming soon)`} className="border-dashed">
      <Flex justifyContent="between" alignItems="start" className="gap-3">
        <Title>{title}</Title>
        <span className="rounded-full bg-tremor-background-subtle px-2 py-0.5 text-xs text-tremor-content-subtle">
          Coming soon
        </span>
      </Flex>
      <Text className="mt-3 text-tremor-content-subtle">{reason}</Text>
    </Card>
  );
}
