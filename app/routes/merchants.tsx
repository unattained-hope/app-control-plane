import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Card, Text, Title, Flex } from "@tremor/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { trpc } from "~/lib/trpc.js";

/**
 * Merchant directory (cp-merchant-directory). A read-only, server-driven table
 * over `trpc.directory.list`: search, sort and pagination are all pushed to the
 * server (the replica owns app-DB fields, so nothing is editable here). The
 * snapshot's `asOf` timestamp is surfaced because every row is replica-sourced.
 *
 * @tanstack/react-table renders the grid in MANUAL mode — it never sorts or
 * paginates client-side; it only translates header clicks / page controls into
 * the query input the server already understands.
 */

type SortField = "installDate" | "plan" | "status";
type SortDirection = "asc" | "desc";

interface MerchantRow {
  readonly shop: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly plan: string | null;
  readonly installedAt: string; // ISO
}

/** Map a react-table column id to the server's `sortField` (or null if unsortable). */
const COLUMN_SORT_FIELD: Readonly<Record<string, SortField | undefined>> = {
  installedAt: "installDate",
  plan: "plan",
  status: "status",
};

const PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

/** Render an ISO timestamp as a stable, locale-aware label (falls back to raw). */
function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

const columnHelper = createColumnHelper<MerchantRow>();

const columns = [
  columnHelper.accessor("name", {
    header: "Merchant",
    enableSorting: false,
    cell: (info) => (
      <Link
        to={`/merchants/${encodeURIComponent(info.row.original.shop)}`}
        className="apoaap-merchant-link"
        aria-label={`Open ${info.row.original.name || info.row.original.shop}`}
      >
        <span className="apoaap-merchant-name">
          {info.getValue() || info.row.original.shop}
        </span>
        <span className="apoaap-merchant-shop">{info.row.original.shop}</span>
      </Link>
    ),
  }),
  columnHelper.accessor("email", {
    header: "Email",
    enableSorting: false,
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("status", {
    header: "Status",
    enableSorting: true,
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("plan", {
    header: "Plan",
    enableSorting: true,
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("installedAt", {
    header: "Installed",
    enableSorting: true,
    cell: (info) => {
      const iso = info.getValue();
      return iso ? (
        <time dateTime={iso}>{formatTimestamp(iso)}</time>
      ) : (
        "—"
      );
    },
  }),
];

export default function Merchants() {
  // Debounced-ish: we update on submit / change but never sort client-side.
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "installedAt", desc: true },
  ]);

  // Translate react-table sorting state into the server's sortField/sortDirection.
  const activeSort = sorting[0];
  const sortField: SortField | undefined = activeSort
    ? COLUMN_SORT_FIELD[activeSort.id]
    : undefined;
  const sortDirection: SortDirection | undefined =
    activeSort && sortField ? (activeSort.desc ? "desc" : "asc") : undefined;

  const listQuery = trpc.directory.list.useQuery({
    search: appliedSearch || undefined,
    sortField,
    sortDirection,
    page,
    pageSize,
  });

  const rows: readonly MerchantRow[] = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const asOf = listQuery.data?.asOf;

  const pageCount = useMemo(
    () => (pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1),
    [total, pageSize],
  );

  const tableData = useMemo<MerchantRow[]>(() => [...rows], [rows]);

  const table = useReactTable<MerchantRow>({
    data: tableData,
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    pageCount,
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(sorting) : updater;
      // Only keep sort state for server-sortable columns; reset to page 1.
      const head = next[0];
      if (head && COLUMN_SORT_FIELD[head.id]) {
        setSorting([head]);
      } else {
        setSorting([]);
      }
      setPage(1);
    },
    getCoreRowModel: getCoreRowModel(),
  });

  function submitSearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedSearch(searchInput.trim());
    setPage(1);
  }

  function clearSearch(): void {
    setSearchInput("");
    setAppliedSearch("");
    setPage(1);
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <main className="apoaap-merchants p-6" aria-label="Merchant directory">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Merchants</Title>
        {asOf ? (
          <Text className="text-xs text-tremor-content-subtle">
            as of <time dateTime={asOf}>{formatTimestamp(asOf)}</time>
          </Text>
        ) : null}
      </Flex>

      <form
        role="search"
        aria-label="Search merchants"
        className="apoaap-merchant-search mb-4"
        onSubmit={submitSearch}
      >
        <label
          htmlFor="merchant-search"
          className="apoaap-merchant-search-label"
        >
          Search merchants
        </label>
        <div className="apoaap-merchant-search-row">
          <input
            id="merchant-search"
            type="search"
            name="search"
            value={searchInput}
            placeholder="Shop domain, name or email"
            onChange={(event) => setSearchInput(event.target.value)}
            className="apoaap-merchant-search-input"
            aria-describedby="merchant-search-hint"
          />
          <button type="submit" className="apoaap-btn">
            Search
          </button>
          {appliedSearch ? (
            <button
              type="button"
              className="apoaap-btn apoaap-btn-secondary"
              onClick={clearSearch}
            >
              Clear
            </button>
          ) : null}
        </div>
        <span
          id="merchant-search-hint"
          className="apoaap-merchant-search-hint text-xs text-tremor-content-subtle"
        >
          Server-side search across the merchant replica.
        </span>
      </form>

      <Card className="apoaap-merchant-table-card">
        {listQuery.isError ? (
          <div role="alert" aria-label="Merchant load error" className="p-4">
            <Text>Couldn't load merchants.</Text>
            <Text className="mt-1 text-xs text-tremor-content-subtle">
              {listQuery.error.message}
            </Text>
          </div>
        ) : (
          <div
            className="apoaap-merchant-table-wrap"
            aria-busy={listQuery.isLoading || listQuery.isFetching}
          >
            <table className="apoaap-merchant-table" aria-label="Merchants">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sortDir = header.column.getIsSorted();
                      const ariaSort: React.AriaAttributes["aria-sort"] =
                        sortDir === "asc"
                          ? "ascending"
                          : sortDir === "desc"
                            ? "descending"
                            : canSort
                              ? "none"
                              : undefined;
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={ariaSort}
                          className="apoaap-merchant-th"
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <button
                              type="button"
                              className="apoaap-th-sort"
                              onClick={header.column.getToggleSortingHandler()}
                              aria-label={`Sort by ${String(
                                flexRender(
                                  header.column.columnDef.header,
                                  header.getContext(),
                                ),
                              )}`}
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              <span aria-hidden="true" className="apoaap-th-arrow">
                                {sortDir === "asc"
                                  ? " ▲"
                                  : sortDir === "desc"
                                    ? " ▼"
                                    : " ⇅"}
                              </span>
                            </button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="apoaap-merchant-td-state"
                    >
                      <Text role="status">Loading merchants…</Text>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="apoaap-merchant-td-state"
                    >
                      <div
                        role="status"
                        aria-label="No merchants found"
                        className="apoaap-merchant-empty"
                      >
                        <Text className="font-medium">No merchants found</Text>
                        <Text className="mt-1 text-xs text-tremor-content-subtle">
                          {appliedSearch
                            ? `Nothing matched “${appliedSearch}”. Try a different search.`
                            : "There are no merchants to show yet."}
                        </Text>
                      </div>
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="apoaap-merchant-tr">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="apoaap-merchant-td">
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

      <nav
        className="apoaap-merchant-pagination mt-4"
        aria-label="Merchant pagination"
      >
        <Flex justifyContent="between" alignItems="center" className="gap-4">
          <Text className="text-xs text-tremor-content-subtle" role="status">
            {total === 0
              ? "0 merchants"
              : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
          </Text>

          <div className="apoaap-merchant-pagination-controls">
            <label
              htmlFor="merchant-page-size"
              className="apoaap-merchant-page-size-label"
            >
              Rows per page
            </label>
            <select
              id="merchant-page-size"
              aria-label="Rows per page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="apoaap-btn apoaap-btn-secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || listQuery.isLoading}
              aria-label="Previous page"
            >
              Previous
            </button>
            <Text className="apoaap-merchant-page-indicator text-xs">
              Page {page} of {pageCount}
            </Text>
            <button
              type="button"
              className="apoaap-btn apoaap-btn-secondary"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || listQuery.isLoading}
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </Flex>
      </nav>
    </main>
  );
}
