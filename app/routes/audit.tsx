import { useMemo, useState } from "react";
import { Card, Text, Title, Flex } from "@tremor/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";

/**
 * Audit log viewer (cp-audit-log). Read-only and ADMIN-only: the `audit:view`
 * ability is granted only to ADMIN, so the server returns FORBIDDEN for any
 * other role. This view detects that code and renders an explicit "ADMIN only"
 * message instead of a generic error.
 *
 * Filters (actor, app, merchant shop, action, date range) are pushed straight
 * into `trpc.audit.query` — the server owns the WHERE clause; nothing is
 * filtered or sorted client-side. Every row is replica/append-log sourced, so
 * the most-recent `createdAt` is surfaced as an "as of" marker.
 */

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
  readonly from: string; // datetime-local value (local time) or ""
  readonly to: string; // datetime-local value (local time) or ""
}

const EMPTY_FILTERS: AuditFilters = {
  actorUserId: "",
  appKey: "",
  merchantShop: "",
  action: "",
  from: "",
  to: "",
};

const RESULT_LIMIT = 200;

/** Render an ISO timestamp as a stable, locale-aware label (falls back to raw). */
function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

/**
 * Turn a `datetime-local` value (which has no timezone, so it's read as local
 * time) into a `Date` for the `from`/`to` filters, or `undefined` when
 * blank/invalid. The server input is `z.coerce.date()`, whose client-facing
 * input type is `Date`.
 */
function localInputToDate(value: string): Date | undefined {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts);
}

/**
 * Summarize a before/after JSON blob into a compact, single-line label for the
 * table. Objects are reduced to their key list; primitives are stringified;
 * empty/absent values render an em dash.
 */
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

const columns = [
  columnHelper.accessor("createdAt", {
    header: "When",
    cell: (info) => {
      const iso = info.getValue();
      return <time dateTime={iso}>{formatTimestamp(iso)}</time>;
    },
  }),
  columnHelper.accessor("actorUserId", {
    header: "Actor",
    cell: (info) => info.getValue() || "—",
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
    cell: (info) => info.getValue() ?? "—",
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

  const queryInput = useMemo(
    () => ({
      actorUserId: applied.actorUserId.trim() || undefined,
      appKey: applied.appKey.trim() || undefined,
      merchantShop: applied.merchantShop.trim() || undefined,
      action: applied.action.trim() || undefined,
      from: localInputToDate(applied.from),
      to: localInputToDate(applied.to),
      limit: RESULT_LIMIT,
    }),
    [applied],
  );

  const auditQuery = trpc.audit.query.useQuery(queryInput, {
    // FORBIDDEN means "not an ADMIN" — that's a stable, expected outcome for the
    // session, so don't keep retrying it.
    retry: (failureCount, error) =>
      error.data?.code === "FORBIDDEN" ? false : failureCount < 1,
  });

  const isForbidden = auditQuery.error?.data?.code === "FORBIDDEN";

  const rows: readonly AuditRow[] = auditQuery.data ?? [];

  // The append-log is server-ordered newest-first, so the first row's timestamp
  // is the freshest event we know about — use it as the "as of" marker.
  const asOf = rows[0]?.createdAt;

  const tableData = useMemo<AuditRow[]>(() => [...rows], [rows]);

  const table = useReactTable<AuditRow>({
    data: tableData,
    columns,
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

  if (isForbidden) {
    return (
      <main className="apoaap-audit p-6" aria-label="Audit log">
        <Title>Audit log</Title>
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
    <main className="apoaap-audit p-6" aria-label="Audit log">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Audit log</Title>
        {asOf ? (
          <Text className="text-xs text-tremor-content-subtle">
            as of <time dateTime={asOf}>{formatTimestamp(asOf)}</time>
          </Text>
        ) : null}
      </Flex>

      <form
        role="search"
        aria-label="Filter audit log"
        className="apoaap-audit-filters mb-4"
        onSubmit={submitFilters}
      >
        <div className="apoaap-audit-filter-grid">
          <div className="apoaap-audit-field">
            <label htmlFor="audit-actor">Actor user ID</label>
            <input
              id="audit-actor"
              type="text"
              value={draft.actorUserId}
              placeholder="Operator user ID"
              onChange={(event) =>
                updateDraft("actorUserId", event.target.value)
              }
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-app">App key</label>
            <input
              id="audit-app"
              type="text"
              value={draft.appKey}
              placeholder="e.g. saleswitch"
              onChange={(event) => updateDraft("appKey", event.target.value)}
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-shop">Merchant shop</label>
            <input
              id="audit-shop"
              type="text"
              value={draft.merchantShop}
              placeholder="shop.myshopify.com"
              onChange={(event) =>
                updateDraft("merchantShop", event.target.value)
              }
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-action">Action</label>
            <input
              id="audit-action"
              type="text"
              value={draft.action}
              placeholder="e.g. note.add"
              onChange={(event) => updateDraft("action", event.target.value)}
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-from">From</label>
            <input
              id="audit-from"
              type="datetime-local"
              value={draft.from}
              onChange={(event) => updateDraft("from", event.target.value)}
            />
          </div>

          <div className="apoaap-audit-field">
            <label htmlFor="audit-to">To</label>
            <input
              id="audit-to"
              type="datetime-local"
              value={draft.to}
              onChange={(event) => updateDraft("to", event.target.value)}
            />
          </div>
        </div>

        <div className="apoaap-audit-filter-actions">
          <button type="submit" className="apoaap-btn">
            Apply filters
          </button>
          {hasAppliedFilters ? (
            <button
              type="button"
              className="apoaap-btn apoaap-btn-secondary"
              onClick={clearFilters}
            >
              Clear
            </button>
          ) : null}
        </div>
      </form>

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
                      colSpan={columns.length}
                      className="apoaap-audit-td-state"
                    >
                      <Text role="status">Loading audit log…</Text>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
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
      </Card>

      {!auditQuery.isError && rows.length > 0 ? (
        <Text
          className="apoaap-audit-count mt-4 text-xs text-tremor-content-subtle"
          role="status"
        >
          {rows.length >= RESULT_LIMIT
            ? `Showing the latest ${RESULT_LIMIT} entries — narrow the filters to see older events.`
            : `Showing ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`}
        </Text>
      ) : null}
    </main>
  );
}
