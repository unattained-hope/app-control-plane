import { useMemo, useState } from "react";
import { Card, Text, Title, Flex } from "@tremor/react";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Filter,
  Layers,
  LayoutList,
  RefreshCw,
  RotateCcw,
  Rows,
  ScrollText,
  SlidersHorizontal,
  SplitSquareVertical,
  Store,
  User,
  X,
} from "lucide-react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import { StoreAvatar } from "~/components/StoreAvatar.js";
import type { AppRouter } from "~/server/trpc/root.js";
import { AuditActions } from "~/lib/auditActions.js";
import {
  AuditGroupSidebar,
  type AuditGroupingMode,
} from "~/components/audit/AuditGroupSidebar.js";
import { AuditTrailTimeline } from "~/components/audit/AuditTrailTimeline.js";
import {
  getActionCategory,
  type AuditCategoryKey,
  AUDIT_CATEGORIES,
} from "~/lib/auditTrailFormat.js";

/** The known audit action taxonomy, surfaced as filter suggestions (cp-audit-taxonomy). */
const KNOWN_ACTIONS = Object.values(AuditActions).sort();

/**
 * The audit row type is inferred straight from the `audit.query` procedure's
 * output, so the table column accessors stay in lock-step with the server
 * contract (including which fields are optional/nullable) without redeclaring it.
 */
type AuditRow = inferRouterOutputs<AppRouter>["audit"]["query"][number];

/** The set of filters the user has applied (and the form is editing). */
interface AuditFilters {
  readonly actorUserId: string;
  readonly appKey: string;
  readonly merchantShop: string;
  readonly action: string;
  readonly actorType: "" | "INTERNAL" | "SYSTEM";
  readonly source: "" | "UI" | "API" | "JOB";
  readonly from: string; // datetime-local value (local time) or ""
  readonly to: string; // datetime-local value (local time) or ""
}

const EMPTY_FILTERS: AuditFilters = {
  actorUserId: "",
  appKey: "",
  merchantShop: "",
  action: "",
  actorType: "",
  source: "",
  from: "",
  to: "",
};

const RESULT_LIMIT = 500;

/** Render an ISO timestamp as a stable, locale-aware label (falls back to raw). */
function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

/** Turn local datetime-local string to Date. */
function localInputToDate(value: string): Date | undefined {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts);
}

/** Summarize a before/after JSON blob into a compact single-line string. */
function summarizeJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.length} item(s)]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    const shown = keys.slice(0, 4).join(", ");
    return keys.length > 4 ? `{ ${shown}, … }` : `{ ${shown} }`;
  }
  return String(value);
}

const columnHelper = createColumnHelper<AuditRow>();

const tableColumns = [
  columnHelper.accessor("createdAt", {
    header: "When",
    cell: (info) => {
      const iso = info.getValue();
      return <time dateTime={iso}>{formatTimestamp(iso)}</time>;
    },
  }),
  columnHelper.accessor("actorUserId", {
    header: "Actor",
    cell: (info) => {
      const row = info.row.original;
      return row.actorEmail || info.getValue() || "—";
    },
  }),
  columnHelper.accessor("actorType", {
    header: "Actor type",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("source", {
    header: "Source",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("action", {
    header: "Action",
    cell: (info) => (
      <code className="apoaap-audit-action">{info.getValue()}</code>
    ),
  }),
  columnHelper.accessor("appKey", {
    header: "App",
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("merchantShop", {
    header: "Merchant",
    cell: (info) => {
      const shop = info.getValue();
      if (!shop) return "—";
      return (
        <div className="flex items-center gap-2">
          <StoreAvatar shop={shop} size="xs" />
          <span>{shop}</span>
        </div>
      );
    },
  }),
  columnHelper.accessor("target", {
    header: "Target",
    cell: (info) => info.getValue() ?? "—",
  }),
  columnHelper.accessor("before", {
    header: "Before",
    cell: (info) => (
      <span className="apoaap-audit-json" title={summarizeJson(info.getValue())}>
        {summarizeJson(info.getValue())}
      </span>
    ),
  }),
  columnHelper.accessor("after", {
    header: "After",
    cell: (info) => (
      <span className="apoaap-audit-json" title={summarizeJson(info.getValue())}>
        {summarizeJson(info.getValue())}
      </span>
    ),
  }),
];

export default function Audit() {
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_FILTERS);
  const [showFilterBar, setShowFilterBar] = useState(true);
  const [viewFormat, setViewFormat] = useState<"trail" | "table">("trail");

  // Navigation / Grouping selection state
  const [groupingMode, setGroupingMode] = useState<AuditGroupingMode>("handler");
  const [selectedHandlerId, setSelectedHandlerId] = useState<string | null>(null);
  const [selectedStoreShop, setSelectedStoreShop] = useState<string | null>(null);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<AuditCategoryKey | null>(null);

  const queryInput = useMemo(
    () => ({
      actorUserId: applied.actorUserId.trim() || undefined,
      appKey: applied.appKey.trim() || undefined,
      merchantShop: applied.merchantShop.trim() || undefined,
      action: applied.action.trim() || undefined,
      actorType: applied.actorType || undefined,
      source: applied.source || undefined,
      from: localInputToDate(applied.from),
      to: localInputToDate(applied.to),
      limit: RESULT_LIMIT,
    }),
    [applied],
  );

  const auditQuery = trpc.audit.query.useQuery(queryInput, {
    retry: (failureCount, error) =>
      error.data?.code === "FORBIDDEN" ? false : failureCount < 1,
  });

  const isForbidden = auditQuery.error?.data?.code === "FORBIDDEN";
  const rows: readonly AuditRow[] = auditQuery.data ?? [];
  const asOf = rows[0]?.createdAt;

  // React Table model (for legacy / tabular mode)
  const tableData = useMemo<AuditRow[]>(() => [...rows], [rows]);
  const table = useReactTable<AuditRow>({
    data: tableData,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  function updateDraft<K extends keyof AuditFilters>(
    key: K,
    value: AuditFilters[K],
  ): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submitFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setApplied(draft);
  }

  function clearFilters(): void {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  const hasAppliedFilters = useMemo(
    () => Object.values(applied).some((v) => v.trim() !== ""),
    [applied],
  );

  const appliedFiltersCount = useMemo(
    () => Object.values(applied).filter((v) => v.trim() !== "").length,
    [applied],
  );

  // Derive active selection gracefully
  const activeHandlerId = selectedHandlerId ?? rows[0]?.actorUserId ?? null;
  const activeStoreShop =
    selectedStoreShop ??
    (rows[0]?.merchantShop || (rows.length > 0 ? "(Global Operations)" : null));
  const activeCategoryKey =
    selectedCategoryKey ?? (rows[0] ? getActionCategory(rows[0].action).key : null);

  // Handler Selection Handlers
  const handleSelectHandler = (handlerId: string | null, subStoreShop?: string | null) => {
    setSelectedHandlerId(handlerId);
    setSelectedStoreShop(subStoreShop ?? null);
  };

  const handleSelectStore = (shop: string | null, subHandlerId?: string | null) => {
    setSelectedStoreShop(shop);
    setSelectedHandlerId(subHandlerId ?? null);
  };

  const handleSelectCategory = (categoryKey: AuditCategoryKey | null) => {
    setSelectedCategoryKey(categoryKey);
    setSelectedHandlerId(null);
    setSelectedStoreShop(null);
  };

  const handleSelectUnified = () => {
    setSelectedHandlerId(null);
    setSelectedStoreShop(null);
    setSelectedCategoryKey(null);
  };

  // Filter trail events based on Master selection
  const trailRecords = useMemo(() => {
    if (groupingMode === "unified") {
      return rows;
    }

    if (groupingMode === "handler") {
      if (!activeHandlerId) return rows;
      return rows.filter((r) => {
        const matchHandler = r.actorUserId === activeHandlerId;
        if (!matchHandler) return false;
        if (selectedStoreShop) {
          return r.merchantShop === selectedStoreShop;
        }
        return true;
      });
    }

    if (groupingMode === "store") {
      if (!activeStoreShop) return rows;
      return rows.filter((r) => {
        const shopKey = r.merchantShop || "(Global Operations)";
        const matchStore = shopKey === activeStoreShop;
        if (!matchStore) return false;
        if (selectedHandlerId) {
          return r.actorUserId === selectedHandlerId;
        }
        return true;
      });
    }

    if (groupingMode === "category") {
      if (!activeCategoryKey) return rows;
      return rows.filter((r) => getActionCategory(r.action).key === activeCategoryKey);
    }

    return rows;
  }, [rows, groupingMode, activeHandlerId, activeStoreShop, activeCategoryKey, selectedHandlerId, selectedStoreShop]);

  // Compute title & subtitle for the active trail view
  const { trailTitle, trailSubtitle, filterDescription } = useMemo(() => {
    if (groupingMode === "unified") {
      return {
        trailTitle: "Global Activity Trail",
        trailSubtitle: "Complete chronological event stream across all operators and stores",
        filterDescription: undefined,
      };
    }

    if (groupingMode === "handler") {
      const activeHandler = rows.find((r) => r.actorUserId === activeHandlerId);
      const handlerName = activeHandler?.actorEmail || activeHandlerId || "Handler";

      return {
        trailTitle: `Activity Trail: ${handlerName}`,
        trailSubtitle: selectedStoreShop
          ? `Scoping actions by ${handlerName} performed on ${selectedStoreShop}`
          : `All actions performed by ${handlerName} across all stores`,
        filterDescription: selectedStoreShop
          ? `Handler: ${handlerName} & Store: ${selectedStoreShop}`
          : `Handler: ${handlerName}`,
      };
    }

    if (groupingMode === "store") {
      const subHandler = rows.find((r) => r.actorUserId === selectedHandlerId);

      return {
        trailTitle: `Store Trail: ${activeStoreShop || "All Stores"}`,
        trailSubtitle: selectedHandlerId
          ? `Events on store ${activeStoreShop} handled by ${subHandler?.actorEmail || selectedHandlerId}`
          : `All operator and automated system actions on ${activeStoreShop}`,
        filterDescription: selectedHandlerId
          ? `Store: ${activeStoreShop} & Handler: ${subHandler?.actorEmail || selectedHandlerId}`
          : `Store: ${activeStoreShop}`,
      };
    }

    if (groupingMode === "category") {
      const catMeta = activeCategoryKey
        ? AUDIT_CATEGORIES[activeCategoryKey]
        : undefined;

      return {
        trailTitle: `Category Trail: ${catMeta?.label || "Category"}`,
        trailSubtitle: catMeta?.description || "Events categorized under this operational domain",
        filterDescription: `Category: ${catMeta?.label}`,
      };
    }

    return {
      trailTitle: "Activity Trail",
      trailSubtitle: undefined,
      filterDescription: undefined,
    };
  }, [groupingMode, activeHandlerId, activeStoreShop, activeCategoryKey, selectedHandlerId, selectedStoreShop, rows]);

  if (isForbidden) {
    return (
      <main className="apoaap-audit p-6" aria-label="Audit log">
        <Title className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-tremor-brand" aria-hidden="true" />
          <span>Audit log</span>
        </Title>
        <Card className="mt-4" role="alert" aria-label="Audit access denied">
          <Text className="font-medium">ADMIN only</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            The audit log is restricted to ADMIN operators. Your role does not
            have the <code>audit:view</code> permission.
          </Text>
        </Card>
      </main>
    );
  }

  return (
    <main className="apoaap-audit p-4 sm:p-6 flex flex-col gap-4 min-h-screen" aria-label="Audit log">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-gray-200 dark:border-[#22222E]">
        <div>
          <Title className="flex items-center gap-2 text-xl font-bold">
            <ScrollText className="h-5 w-5 text-amber-500" aria-hidden="true" />
            <span>Audit Trail & Activity Log</span>
          </Title>
          <Text className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Immutable point-by-point activity timeline segmented per handler and per merchant store
          </Text>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {asOf ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-600 dark:text-zinc-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Updated {formatTimestamp(asOf)}</span>
            </div>
          ) : null}

          {/* Filter Bar Toggle */}
          <button
            type="button"
            onClick={() => setShowFilterBar(!showFilterBar)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              hasAppliedFilters
                ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
                : "bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {appliedFiltersCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-bold">
                {appliedFiltersCount}
              </span>
            )}
            {showFilterBar ? (
              <ChevronUp className="w-3.5 h-3.5 ml-0.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 ml-0.5" />
            )}
          </button>

          {/* View Format Switcher (Trail vs Table) */}
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewFormat("trail")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                viewFormat === "trail"
                  ? "bg-amber-500 text-white font-semibold shadow-sm"
                  : "text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <SplitSquareVertical className="w-3.5 h-3.5" />
              <span>Split Trail View</span>
            </button>
            <button
              type="button"
              onClick={() => setViewFormat("table")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                viewFormat === "table"
                  ? "bg-amber-500 text-white font-semibold shadow-sm"
                  : "text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Rows className="w-3.5 h-3.5" />
              <span>Table View</span>
            </button>
          </div>
        </div>
      </div>

      {/* Global Filter Toolbar */}
      <form
        role="search"
        aria-label="Filter audit log"
        className={`p-4 bg-white dark:bg-[#0E0E14] border border-gray-200 dark:border-[#22222E] rounded-xl shadow-sm space-y-3 ${
          showFilterBar ? "block" : "hidden"
        }`}
        onSubmit={submitFilters}
      >
        <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold text-gray-900 dark:text-white">
              Filter Audit Log & Server Query
            </span>
          </div>
          {hasAppliedFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset all filters</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="apoaap-audit-field">
            <label htmlFor="audit-actor" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              Actor user ID
            </label>
            <input
              id="audit-actor"
              type="text"
              value={draft.actorUserId}
              placeholder="Operator user ID"
              className="w-full text-xs p-2 rounded-md border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              onChange={(event) =>
                updateDraft("actorUserId", event.target.value)
              }
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-app" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              App key
            </label>
            <input
              id="audit-app"
              type="text"
              value={draft.appKey}
              placeholder="e.g. saleswitch"
              className="w-full text-xs p-2 rounded-md border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              onChange={(event) => updateDraft("appKey", event.target.value)}
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-shop" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              Merchant shop
            </label>
            <input
              id="audit-shop"
              type="text"
              value={draft.merchantShop}
              placeholder="shop.myshopify.com"
              className="w-full text-xs p-2 rounded-md border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              onChange={(event) =>
                updateDraft("merchantShop", event.target.value)
              }
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-action" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              Action
            </label>
            <input
              id="audit-action"
              type="text"
              list="audit-action-options"
              value={draft.action}
              placeholder="e.g. webhook.replayed"
              className="w-full text-xs p-2 rounded-md border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              onChange={(event) => updateDraft("action", event.target.value)}
            />
            <datalist id="audit-action-options">
              {KNOWN_ACTIONS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-actor-type" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              Actor type
            </label>
            <select
              id="audit-actor-type"
              value={draft.actorType}
              className="w-full text-xs p-2 rounded-md border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              onChange={(event) =>
                updateDraft("actorType", event.target.value as AuditFilters["actorType"])
              }
            >
              <option value="">Any</option>
              <option value="INTERNAL">Internal (staff)</option>
              <option value="SYSTEM">System (job)</option>
            </select>
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-source" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              Source
            </label>
            <select
              id="audit-source"
              value={draft.source}
              className="w-full text-xs p-2 rounded-md border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              onChange={(event) =>
                updateDraft("source", event.target.value as AuditFilters["source"])
              }
            >
              <option value="">Any</option>
              <option value="UI">UI</option>
              <option value="API">API</option>
              <option value="JOB">Job</option>
            </select>
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-from" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              From
            </label>
            <input
              id="audit-from"
              type="datetime-local"
              value={draft.from}
              className="w-full text-xs p-1.5 rounded-md border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              onChange={(event) => updateDraft("from", event.target.value)}
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-to" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              To
            </label>
            <input
              id="audit-to"
              type="datetime-local"
              value={draft.to}
              className="w-full text-xs p-1.5 rounded-md border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              onChange={(event) => updateDraft("to", event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
          {hasAppliedFilters && (
            <button
              type="button"
              className="apoaap-btn apoaap-btn-secondary"
              onClick={clearFilters}
            >
              Clear
            </button>
          )}
          <button
            type="submit"
            className="apoaap-btn"
          >
            Apply
          </button>
        </div>
      </form>

      {/* Applied Filters Chips Bar (When filter bar is collapsed) */}
      {hasAppliedFilters && !showFilterBar && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs">
          <span className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Active Filters:</span>
          </span>
          {applied.actorUserId && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200 font-mono">
              Actor: {applied.actorUserId}
            </span>
          )}
          {applied.merchantShop && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200 font-mono">
              Store: {applied.merchantShop}
            </span>
          )}
          {applied.action && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200 font-mono">
              Action: {applied.action}
            </span>
          )}
          {applied.actorType && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200">
              Type: {applied.actorType}
            </span>
          )}
          {applied.source && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200">
              Source: {applied.source}
            </span>
          )}
          {applied.from && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200">
              From: {applied.from}
            </span>
          )}
          {applied.to && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200">
              To: {applied.to}
            </span>
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto text-xs font-semibold text-amber-800 dark:text-amber-300 hover:underline"
          >
            Clear All
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {viewFormat === "trail" ? (
        /* SPLIT MASTER-DETAIL VIEW */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 items-stretch min-h-[680px]">
          {/* Left Master Pane: Grouping Sidebar */}
          <div className="lg:col-span-4 xl:col-span-3.5 bg-white dark:bg-[#0E0E14] border border-gray-200 dark:border-[#22222E] rounded-xl overflow-hidden shadow-sm flex flex-col min-h-[450px]">
            <AuditGroupSidebar
              records={rows}
              mode={groupingMode}
              onModeChange={(m) => {
                setGroupingMode(m);
                setSelectedHandlerId(null);
                setSelectedStoreShop(null);
                setSelectedCategoryKey(null);
              }}
              selectedHandlerId={activeHandlerId}
              selectedStoreShop={selectedStoreShop}
              selectedCategoryKey={activeCategoryKey}
              onSelectHandler={handleSelectHandler}
              onSelectStore={handleSelectStore}
              onSelectCategory={handleSelectCategory}
              onSelectUnified={handleSelectUnified}
            />
          </div>

          {/* Right Detail Pane: Point-by-Point Activity Trail */}
          <div className="lg:col-span-8 xl:col-span-8.5 bg-white dark:bg-[#0E0E14] border border-gray-200 dark:border-[#22222E] rounded-xl overflow-hidden shadow-sm flex flex-col min-h-[450px]">
            <AuditTrailTimeline
              records={trailRecords}
              isLoading={auditQuery.isLoading}
              title={trailTitle}
              subtitle={trailSubtitle}
              activeFilterDescription={filterDescription}
              onClearFilter={() => {
                setSelectedHandlerId(null);
                setSelectedStoreShop(null);
                setSelectedCategoryKey(null);
              }}
            />
          </div>
        </div>
      ) : (
        /* LEGACY FLAT TABLE VIEW */
        <Card className="apoaap-audit-table-card">
          {auditQuery.isError ? (
            <div role="alert" aria-label="Audit load error" className="p-4">
              <Text>Couldn't load the audit log.</Text>
              <Text className="mt-1 text-xs text-tremor-content-subtle">
                {auditQuery.error.message}
              </Text>
            </div>
          ) : (
            <div
              className="apoaap-audit-table-wrap"
              aria-busy={auditQuery.isLoading || auditQuery.isFetching}
            >
              <table className="apoaap-audit-table" aria-label="Audit log entries">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          scope="col"
                          className="apoaap-audit-th"
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {auditQuery.isLoading ? (
                    <tr>
                      <td
                        colSpan={tableColumns.length}
                        className="apoaap-audit-td-state"
                      >
                        <Text role="status">Loading audit log…</Text>
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={tableColumns.length}
                        className="apoaap-audit-td-state"
                      >
                        <div
                          role="status"
                          aria-label="No audit entries found"
                          className="apoaap-audit-empty"
                        >
                          <Text className="font-medium">
                            No audit entries found
                          </Text>
                          <Text className="mt-1 text-xs text-tremor-content-subtle">
                            {hasAppliedFilters
                              ? "Nothing matched these filters. Try widening the date range or clearing a filter."
                              : "There are no audit entries to show yet."}
                          </Text>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="apoaap-audit-tr">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="apoaap-audit-td">
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!auditQuery.isError && rows.length > 0 ? (
            <Text className="apoaap-audit-count" role="status">
              {rows.length >= RESULT_LIMIT
                ? `Latest ${RESULT_LIMIT} entries — use filters to find older events.`
                : `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}
            </Text>
          ) : null}
        </Card>
      )}
    </main>
  );
}
