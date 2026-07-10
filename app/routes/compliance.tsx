import { useMemo, useState } from "react";
import { Badge, Button, Card, Flex, Text, TextInput, Title } from "@tremor/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { trpc } from "~/lib/trpc.js";

/**
 * GDPR/DSR compliance queue (cp-compliance-dsr). ADMIN-only: the underlying
 * `trpc.compliance.*` procedures require `compliance:manage`, so a non-ADMIN gets a
 * FORBIDDEN error here (rendered as an access notice). Each open request shows a
 * countdown to its 30-day `dueAt`; "Mark fulfilled" requires typing the shop domain
 * (type-to-confirm) and writes a `compliance.completed` audit row server-side.
 */

interface ComplianceRow {
  readonly id: string;
  readonly appKey: string;
  readonly topic: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT" | "SHOP_REDACT";
  readonly shop: string;
  readonly status: "RECEIVED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  readonly receivedAt: string;
  readonly dueAt: string;
  readonly dispatchedAt: string | null;
  readonly completedAt: string | null;
}

const TOPIC_LABEL: Readonly<Record<ComplianceRow["topic"], string>> = {
  CUSTOMERS_DATA_REQUEST: "Data request",
  CUSTOMERS_REDACT: "Customer redact",
  SHOP_REDACT: "Shop redact",
};

const STATUS_TONE: Readonly<
  Record<ComplianceRow["status"], "amber" | "blue" | "emerald" | "rose">
> = {
  RECEIVED: "amber",
  IN_PROGRESS: "blue",
  COMPLETED: "emerald",
  FAILED: "rose",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Human countdown to a due date — "overdue", "due today", or "N days left". */
function countdownLabel(dueIso: string): { label: string; overdue: boolean } {
  const due = Date.parse(dueIso);
  if (Number.isNaN(due)) return { label: dueIso, overdue: false };
  const ms = due - Date.now();
  if (ms < 0) {
    const days = Math.ceil(-ms / DAY_MS);
    return { label: `Overdue by ${days}d`, overdue: true };
  }
  const days = Math.floor(ms / DAY_MS);
  if (days === 0) return { label: "Due today", overdue: false };
  return { label: `${days}d left`, overdue: false };
}

function formatDate(iso: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleDateString();
}

/** Inline type-to-confirm control for "Mark fulfilled". */
function MarkFulfilled({ row, onDone }: { row: ComplianceRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const markCompleted = trpc.compliance.markCompleted.useMutation({
    onSuccess: () => {
      setOpen(false);
      setConfirmText("");
      onDone();
    },
  });

  const confirmed = confirmText === row.shop;

  if (!open) {
    return (
      <Button size="xs" variant="secondary" onClick={() => setOpen(true)}>
        Mark fulfilled
      </Button>
    );
  }

  return (
    <form
      aria-label={`Confirm fulfilment for ${row.shop}`}
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirmed || markCompleted.isPending) return;
        markCompleted.mutate({ id: row.id, confirmText });
      }}
    >
      <Text className="text-xs text-tremor-content-subtle">
        Type <code>{row.shop}</code> to confirm
      </Text>
      <TextInput
        placeholder={row.shop}
        value={confirmText}
        onValueChange={setConfirmText}
        aria-label="Type the shop domain to confirm"
        error={confirmText.length > 0 && !confirmed}
      />
      <div className="flex gap-2">
        <Button
          size="xs"
          type="submit"
          disabled={!confirmed || markCompleted.isPending}
          loading={markCompleted.isPending}
        >
          Confirm
        </Button>
        <Button size="xs" variant="light" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {markCompleted.isError ? (
        <Text className="text-xs text-rose-600" role="alert">
          {markCompleted.error.message}
        </Text>
      ) : null}
    </form>
  );
}

const columnHelper = createColumnHelper<ComplianceRow>();

export default function Compliance() {
  const pendingQuery = trpc.compliance.pending.useQuery(undefined, { retry: false });

  const refetch = () => void pendingQuery.refetch();

  const columns = useMemo(
    () => [
      columnHelper.accessor("shop", { header: "Shop", cell: (i) => i.getValue() }),
      columnHelper.accessor("topic", {
        header: "Request",
        cell: (i) => <Badge color="gray">{TOPIC_LABEL[i.getValue()]}</Badge>,
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (i) => (
          <Badge color={STATUS_TONE[i.getValue()]}>{i.getValue().replace("_", " ")}</Badge>
        ),
      }),
      columnHelper.accessor("receivedAt", {
        header: "Received",
        cell: (i) => <time dateTime={i.getValue()}>{formatDate(i.getValue())}</time>,
      }),
      columnHelper.accessor("dueAt", {
        header: "SLA",
        cell: (i) => {
          const c = countdownLabel(i.getValue());
          return (
            <span title={`Due ${formatDate(i.getValue())}`}>
              <Badge color={c.overdue ? "rose" : "amber"}>{c.label}</Badge>
            </span>
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (i) => <MarkFulfilled row={i.row.original} onDone={refetch} />,
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const rows: readonly ComplianceRow[] = pendingQuery.data ?? [];
  const data = useMemo<ComplianceRow[]>(() => [...rows], [rows]);

  const table = useReactTable<ComplianceRow>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <main className="p-6" aria-label="GDPR / DSR compliance queue">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Compliance — data-subject requests</Title>
        <Text className="text-xs text-tremor-content-subtle">
          30-day SLA · {rows.length} open
        </Text>
      </Flex>

      <Card>
        {pendingQuery.isError ? (
          <div role="alert" aria-label="Compliance load error" className="p-2">
            <Text>Couldn't load the compliance queue.</Text>
            <Text className="mt-1 text-xs text-tremor-content-subtle">
              {pendingQuery.error.message}
            </Text>
          </div>
        ) : pendingQuery.isLoading ? (
          <Text role="status">Loading compliance queue…</Text>
        ) : rows.length === 0 ? (
          <div role="status" aria-label="No open compliance requests">
            <Text className="font-medium">No open requests</Text>
            <Text className="mt-1 text-xs text-tremor-content-subtle">
              Mandatory GDPR webhooks are ingested automatically; open requests appear here
              with a countdown to their 30-day deadline.
            </Text>
          </div>
        ) : (
          <table className="apoaap-merchant-table" aria-label="Compliance requests">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th key={header.id} scope="col" className="apoaap-merchant-th">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
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
        )}
      </Card>
    </main>
  );
}
