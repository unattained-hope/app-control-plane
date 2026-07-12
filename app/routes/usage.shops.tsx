import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Badge,
  Card,
  ScatterChart,
  Select,
  SelectItem,
  Text,
  TextInput,
} from "@tremor/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { trpc } from "~/lib/trpc.js";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "~/server/trpc/root.js";
import { UsagePageShell } from "~/components/usage/UsagePageShell.js";
import { ChartCard } from "~/components/usage/chartChrome.js";
import { SavedViewsBar, type SavedViewParams } from "~/components/usage/SavedViewsBar.js";
import {
  INTENSITY_META,
  LIFECYCLE_META,
  PERSONA_LABEL,
  chartNumberFormatter,
} from "~/components/usage/usageLabels.js";

/**
 * Shop explorer (`/usage/shops`, usage-analytics Phase 4 + P5). A ScatterChart dot plot —
 * one point per shop, switchable axes (30-day activity score / tenure / campaigns activated)
 * coloured by lifecycle or intensity — over a filterable, sortable TanStack table whose
 * rows link to the merchant detail page. The payload is one aggregate row per shop from
 * the latest `UsageCohortSnapshot` run (bounded by shop count, not events); axis switching
 * is entirely client-side over that payload (design.md Decision 4).
 *
 * P5: the explorer's state (axes, color-by, lifecycle/intensity filters, search) is
 * saveable as a per-admin named preset via `SavedViewsBar` — selecting a preset restores
 * exactly that state. Presets are owner-scoped; this page only sees the acting admin's own.
 */

/** The explorer state persisted in a saved view (owner-scoped preset). */
interface ExplorerViewParams {
  readonly xAxis: AxisKey;
  readonly yAxis: AxisKey;
  readonly colorBy: ColorKey;
  readonly lifecycleFilter: string;
  readonly intensityFilter: string;
  readonly search: string;
}

const AXIS_KEYS = ["activityScore", "tenureDays", "campaignsActivated"] as const;
const COLOR_KEYS = ["lifecycle", "intensity"] as const;

/** Coerce an untrusted saved blob into a valid ExplorerViewParams (defensive on restore). */
function coerceViewParams(raw: unknown): ExplorerViewParams | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const axis = (v: unknown, fallback: AxisKey): AxisKey =>
    typeof v === "string" && (AXIS_KEYS as readonly string[]).includes(v) ? (v as AxisKey) : fallback;
  const color = (v: unknown): ColorKey =>
    typeof v === "string" && (COLOR_KEYS as readonly string[]).includes(v) ? (v as ColorKey) : "lifecycle";
  const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  return {
    xAxis: axis(p.xAxis, "activityScore"),
    yAxis: axis(p.yAxis, "campaignsActivated"),
    colorBy: color(p.colorBy),
    lifecycleFilter: str(p.lifecycleFilter, "ALL"),
    intensityFilter: str(p.intensityFilter, "ALL"),
    search: str(p.search, ""),
  };
}

type ShopsPayload = inferRouterOutputs<AppRouter>["usage"]["shops"];
type ShopRow = ShopsPayload["shops"][number];

const AXES = [
  { key: "activityScore", label: "30-day activity score", populated: true },
  { key: "tenureDays", label: "Tenure (days)", populated: false },
  { key: "campaignsActivated", label: "Campaigns activated", populated: false },
] as const;
type AxisKey = (typeof AXES)[number]["key"];

const COLOR_BY = [
  { key: "lifecycle", label: "Lifecycle" },
  { key: "intensity", label: "Intensity" },
] as const;
type ColorKey = (typeof COLOR_BY)[number]["key"];

const columnHelper = createColumnHelper<ShopRow>();

export default function UsageShops() {
  const q = trpc.usage.shops.useQuery();
  const data = q.data;
  const shops = useMemo<ShopRow[]>(() => [...(data?.shops ?? [])], [data]);

  const [xAxis, setXAxis] = useState<AxisKey>("activityScore");
  const [yAxis, setYAxis] = useState<AxisKey>("campaignsActivated");
  const [colorBy, setColorBy] = useState<ColorKey>("lifecycle");
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("ALL");
  const [intensityFilter, setIntensityFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "activityScore", desc: true }]);

  // The current explorer state, in the shape a saved view stores. Typed as the opaque
  // SavedViewParams the bar round-trips; restoring a preset coerces it back (below).
  const currentViewParams: SavedViewParams = {
    xAxis,
    yAxis,
    colorBy,
    lifecycleFilter,
    intensityFilter,
    search,
  } satisfies ExplorerViewParams;
  const restoreView = (raw: SavedViewParams) => {
    const p = coerceViewParams(raw);
    if (!p) return;
    setXAxis(p.xAxis);
    setYAxis(p.yAxis);
    setColorBy(p.colorBy);
    setLifecycleFilter(p.lifecycleFilter);
    setIntensityFilter(p.intensityFilter);
    setSearch(p.search);
  };

  const filtered = useMemo(
    () =>
      shops.filter((s) => {
        if (lifecycleFilter !== "ALL" && s.lifecycle !== lifecycleFilter) return false;
        if (intensityFilter !== "ALL" && s.intensity !== intensityFilter) return false;
        if (search.trim() && !s.shop.toLowerCase().includes(search.trim().toLowerCase())) return false;
        return true;
      }),
    [shops, lifecycleFilter, intensityFilter, search],
  );

  const scatterData = filtered.map((s) => ({
    shop: s.shop,
    [xAxis]: axisValue(s, xAxis),
    [yAxis]: axisValue(s, yAxis),
    // The `category` field carries the colour dimension's value per point.
    category: colorBy === "lifecycle" ? LIFECYCLE_META[s.lifecycle]?.label ?? s.lifecycle : INTENSITY_META[s.intensity]?.label ?? s.intensity,
  }));

  const columns = useMemo(
    () => [
      columnHelper.accessor("shop", {
        header: "Shop",
        cell: (i) => (
          <Link to={`/merchants/${encodeURIComponent(i.getValue())}`} className="text-tremor-brand hover:underline">
            {i.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor("lifecycle", {
        header: "Lifecycle",
        cell: (i) => (
          <Badge color={LIFECYCLE_META[i.getValue()]?.color ?? "gray"}>
            {LIFECYCLE_META[i.getValue()]?.label ?? i.getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor("intensity", {
        header: "Intensity",
        cell: (i) => (
          <Badge color={INTENSITY_META[i.getValue()]?.color ?? "gray"}>
            {INTENSITY_META[i.getValue()]?.label ?? i.getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor("activityScore", {
        header: "Activity score",
        cell: (i) => chartNumberFormatter(i.getValue()),
      }),
      columnHelper.accessor("personaTags", {
        header: "Personas",
        enableSorting: false,
        cell: (i) => {
          const tags = i.getValue();
          if (!tags || tags.length === 0) return <Text className="text-tremor-content-subtle">—</Text>;
          return (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t} color="gray">
                  {PERSONA_LABEL[t] ?? t}
                </Badge>
              ))}
            </div>
          );
        },
      }),
    ],
    [],
  );

  const table = useReactTable<ShopRow>({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <UsagePageShell
      title="Shops"
      description="Every shop as one point and one row — slice by cohort, drill into any merchant."
      asOf={data?.asOf}
    >
      {q.isLoading ? (
        <Card role="status" aria-busy="true">
          <Text className="text-tremor-content-subtle">Loading shops…</Text>
        </Card>
      ) : q.isError ? (
        <Card role="alert" aria-label="Shops load error">
          <Text>Couldn't load the shop explorer.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">{q.error.message}</Text>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card aria-label="Saved explorer views">
            <SavedViewsBar currentParams={currentViewParams} onRestore={restoreView} />
          </Card>

          <ChartCard
            title="Shop distribution"
            subtitle={`${filtered.length} of ${shops.length} shops`}
            isEmpty={scatterData.length === 0}
            collectingSince={data?.collectingSince}
            asOf={data?.asOf}
            ariaLabel="Shop distribution"
            actions={
              <div className="flex flex-wrap items-end gap-2">
                <AxisSelect label="X" value={xAxis} onChange={setXAxis} />
                <AxisSelect label="Y" value={yAxis} onChange={setYAxis} />
                <div className="w-36">
                  <Text className="mb-1 text-xs text-tremor-content-subtle">Colour</Text>
                  <Select value={colorBy} onValueChange={(v) => setColorBy(v as ColorKey)} aria-label="Colour by">
                    {COLOR_BY.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
              </div>
            }
          >
            <ScatterChart
              className="mt-2 h-80"
              data={scatterData}
              x={xAxis}
              y={yAxis}
              category="category"
              showAnimation={false}
              valueFormatter={{ x: chartNumberFormatter, y: chartNumberFormatter }}
              yAxisWidth={48}
              noDataText="No shops match these filters."
            />
            {(!axisPopulated(xAxis) || !axisPopulated(yAxis)) && scatterData.length > 0 ? (
              <Text className="mt-3 text-xs text-tremor-content-subtle">
                Tenure and campaigns-activated aren't carried on the cohort snapshot yet, so
                those axes read 0 for now. 30-day activity score is live.
              </Text>
            ) : null}
          </ChartCard>

          <Card aria-label="Shop cohort table">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="w-56">
                <Text className="mb-1 text-xs text-tremor-content-subtle">Search shop</Text>
                <TextInput
                  placeholder="shop.myshopify.com"
                  value={search}
                  onValueChange={setSearch}
                  aria-label="Search shop domain"
                />
              </div>
              <div className="w-44">
                <Text className="mb-1 text-xs text-tremor-content-subtle">Lifecycle</Text>
                <Select value={lifecycleFilter} onValueChange={setLifecycleFilter} aria-label="Filter lifecycle">
                  <SelectItem value="ALL">All lifecycles</SelectItem>
                  {Object.entries(LIFECYCLE_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      {m.label}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="w-44">
                <Text className="mb-1 text-xs text-tremor-content-subtle">Intensity</Text>
                <Select value={intensityFilter} onValueChange={setIntensityFilter} aria-label="Filter intensity">
                  <SelectItem value="ALL">All intensities</SelectItem>
                  {Object.entries(INTENSITY_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      {m.label}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>

            {shops.length === 0 ? (
              <div role="status" aria-label="No cohort data yet">
                <Text className="font-medium">No cohort snapshots yet</Text>
                <Text className="mt-1 text-xs text-tremor-content-subtle">
                  {data?.collectingSince
                    ? `Collecting since ${data.collectingSince} — the nightly cohort job populates this.`
                    : "The nightly cohort job populates this once it has run."}
                </Text>
              </div>
            ) : filtered.length === 0 ? (
              <div role="status" aria-label="No shops match filters">
                <Text className="text-tremor-content-subtle">No shops match these filters.</Text>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="apoaap-merchant-table" aria-label="Shop cohort table">
                  <thead>
                    {table.getHeaderGroups().map((hg) => (
                      <tr key={hg.id}>
                        {hg.headers.map((header) => (
                          <th key={header.id} scope="col" className="apoaap-merchant-th">
                            {header.isPlaceholder ? null : (
                              <button
                                type="button"
                                className={header.column.getCanSort() ? "flex items-center gap-1" : ""}
                                onClick={header.column.getToggleSortingHandler()}
                                disabled={!header.column.getCanSort()}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {header.column.getIsSorted() === "asc"
                                  ? " ↑"
                                  : header.column.getIsSorted() === "desc"
                                    ? " ↓"
                                    : null}
                              </button>
                            )}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="apoaap-merchant-tr">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="apoaap-merchant-td">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </UsagePageShell>
  );
}

function AxisSelect({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: AxisKey;
  readonly onChange: (v: AxisKey) => void;
}) {
  return (
    <div className="w-44">
      <Text className="mb-1 text-xs text-tremor-content-subtle">{label} axis</Text>
      <Select value={value} onValueChange={(v) => onChange(v as AxisKey)} aria-label={`${label} axis`}>
        {AXES.map((a) => (
          <SelectItem key={a.key} value={a.key}>
            {a.label}
            {a.populated ? "" : " (no data yet)"}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}

function axisValue(s: ShopRow, axis: AxisKey): number {
  if (axis === "activityScore") return s.activityScore;
  if (axis === "tenureDays") return s.tenureDays ?? 0;
  return s.campaignsActivated;
}

function axisPopulated(axis: AxisKey): boolean {
  return AXES.find((a) => a.key === axis)?.populated ?? false;
}
