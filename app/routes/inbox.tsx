import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Divider,
  Flex,
  Select,
  SelectItem,
  Text,
  Textarea,
  Title,
} from "@tremor/react";
import { trpc } from "~/lib/trpc.js";

/**
 * Agent inbox (cp-support-inbox, AC7.4).
 *
 * Left pane: the conversation list from `trpc.chat.conversations` (filterable by
 * status OPEN / SNOOZED / CLOSED), surfacing per-conversation unread counts and
 * the `lastMessageAt` recency. Selecting a conversation loads its message stream
 * via `trpc.chat.history`, rendered with per-`senderType` styling.
 *
 * The composer is render-only here: the realtime send path is socket.io elsewhere,
 * and a read-only VIEWER cannot reply at all. RBAC is enforced server-side; this
 * route only renders the disabled-composer affordance + an explanatory note. The
 * route owns no business logic — it is loaders/queries + presentation.
 */

type ConversationStatus = "OPEN" | "SNOOZED" | "CLOSED";
type StatusFilter = "ALL" | ConversationStatus;
type SenderType = "MERCHANT" | "AGENT" | "SYSTEM";

interface Conversation {
  readonly id: string;
  readonly shop: string;
  readonly status: ConversationStatus;
  readonly assignedTo: string | null;
  readonly unreadCount: number;
  readonly lastMessageAt: string | null; // ISO
}

interface ChatMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderType: SenderType;
  readonly senderId: string;
  readonly body: string;
  readonly attachmentUrl: string | null;
  readonly createdAt: string; // ISO
}

const STATUS_FILTERS: ReadonlyArray<{
  readonly value: StatusFilter;
  readonly label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "SNOOZED", label: "Snoozed" },
  { value: "CLOSED", label: "Closed" },
];

const STATUS_TONE: Readonly<
  Record<ConversationStatus, "emerald" | "amber" | "gray">
> = {
  OPEN: "emerald",
  SNOOZED: "amber",
  CLOSED: "gray",
};

const STATUS_LABEL: Readonly<Record<ConversationStatus, string>> = {
  OPEN: "Open",
  SNOOZED: "Snoozed",
  CLOSED: "Closed",
};

const SENDER_LABEL: Readonly<Record<SenderType, string>> = {
  MERCHANT: "Merchant",
  AGENT: "Agent",
  SYSTEM: "System",
};

/** Render an ISO timestamp as a stable, locale-aware label (falls back to raw). */
function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

function AsOf({ iso }: { readonly iso: string }) {
  return (
    <Text className="text-xs text-tremor-content-subtle">
      as of <time dateTime={iso}>{formatTimestamp(iso)}</time>
    </Text>
  );
}

/** A single conversation row in the master list; doubles as the selectable button. */
function ConversationListItem({
  conversation,
  selected,
  onSelect,
}: {
  readonly conversation: Conversation;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const hasUnread = conversation.unreadCount > 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-pressed={selected}
        aria-label={`Conversation with ${conversation.shop}, ${
          STATUS_LABEL[conversation.status]
        }, ${conversation.unreadCount} unread`}
        className={
          selected
            ? "w-full rounded border border-tremor-brand bg-tremor-brand-faint px-3 py-2 text-left"
            : "w-full rounded border border-tremor-border bg-tremor-background px-3 py-2 text-left hover:bg-tremor-background-muted"
        }
      >
        <Flex justifyContent="between" alignItems="start">
          <Text className="font-medium text-tremor-content-strong">
            {conversation.shop}
          </Text>
          {hasUnread ? (
            <Badge
              color="rose"
              aria-label={`${conversation.unreadCount} unread messages`}
            >
              {conversation.unreadCount}
            </Badge>
          ) : null}
        </Flex>
        <Flex justifyContent="between" alignItems="center" className="mt-1 gap-2">
          <Badge
            color={STATUS_TONE[conversation.status]}
            aria-label={`Status ${STATUS_LABEL[conversation.status]}`}
          >
            {STATUS_LABEL[conversation.status]}
          </Badge>
          <Text className="text-xs text-tremor-content-subtle">
            {conversation.lastMessageAt ? (
              <time dateTime={conversation.lastMessageAt}>
                {formatTimestamp(conversation.lastMessageAt)}
              </time>
            ) : (
              "No messages yet"
            )}
          </Text>
        </Flex>
        {conversation.assignedTo ? (
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            Assigned to {conversation.assignedTo}
          </Text>
        ) : null}
      </button>
    </li>
  );
}

/** The conversation master list (left pane), with status filter + states. */
function ConversationList({
  statusFilter,
  onStatusFilterChange,
  selectedId,
  onSelect,
}: {
  readonly statusFilter: StatusFilter;
  readonly onStatusFilterChange: (next: StatusFilter) => void;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  const conversationsQuery = trpc.chat.conversations.useQuery(
    statusFilter === "ALL" ? {} : { status: statusFilter },
  );

  return (
    <Card aria-label="Conversations">
      <Flex justifyContent="between" alignItems="center" className="gap-2">
        <Title>Conversations</Title>
      </Flex>

      <div className="mt-3">
        <label htmlFor="inbox-status-filter" className="sr-only">
          Filter conversations by status
        </label>
        <Select
          id="inbox-status-filter"
          value={statusFilter}
          onValueChange={(v) => onStatusFilterChange(v as StatusFilter)}
          aria-label="Filter conversations by status"
          enableClear={false}
        >
          {STATUS_FILTERS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label}
            </SelectItem>
          ))}
        </Select>
      </div>

      <Divider className="my-3" />

      {conversationsQuery.isLoading ? (
        <Text role="status" aria-busy="true">
          Loading conversations…
        </Text>
      ) : conversationsQuery.isError ? (
        <div role="alert" aria-label="Conversation load error">
          <Text>Couldn't load conversations.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            {conversationsQuery.error.message}
          </Text>
        </div>
      ) : (conversationsQuery.data ?? []).length === 0 ? (
        <Text role="status" className="text-tremor-content-subtle">
          No conversations match this filter.
        </Text>
      ) : (
        <ul
          className="flex flex-col gap-2"
          aria-label="Conversation list"
        >
          {(conversationsQuery.data ?? []).map((c) => (
            <ConversationListItem
              key={c.id}
              conversation={c}
              selected={c.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One message bubble, styled by `senderType`. */
function MessageBubble({ message }: { readonly message: ChatMessage }) {
  const alignClass =
    message.senderType === "AGENT"
      ? "ml-auto bg-tremor-brand-faint border-tremor-brand"
      : message.senderType === "SYSTEM"
        ? "mx-auto bg-tremor-background-muted border-tremor-border italic"
        : "mr-auto bg-tremor-background border-tremor-border";

  return (
    <li
      className={`max-w-[80%] rounded border px-3 py-2 ${alignClass}`}
      aria-label={`${SENDER_LABEL[message.senderType]} message`}
    >
      <Flex justifyContent="between" alignItems="baseline" className="gap-3">
        <Text className="text-xs font-medium text-tremor-content-strong">
          {SENDER_LABEL[message.senderType]}
          <span className="text-tremor-content-subtle"> · {message.senderId}</span>
        </Text>
        <Text className="text-xs text-tremor-content-subtle">
          <time dateTime={message.createdAt}>
            {formatTimestamp(message.createdAt)}
          </time>
        </Text>
      </Flex>
      <Text className="mt-1 whitespace-pre-wrap text-tremor-content-strong">
        {message.body}
      </Text>
      {message.attachmentUrl ? (
        <a
          href={message.attachmentUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block text-xs text-tremor-brand hover:underline"
          aria-label="Open attachment (new tab)"
        >
          Attachment ↗
        </a>
      ) : null}
    </li>
  );
}

/**
 * Read-only reply composer. The send path is socket.io elsewhere; this renders
 * the textarea + disabled send button only. A VIEWER (read-only role) cannot
 * reply — server-side RBAC is authoritative, so the control is rendered disabled
 * with an explanatory note rather than wired to any mutation.
 */
function ReplyComposer({ shop }: { readonly shop: string }) {
  const [draft, setDraft] = useState("");

  return (
    <form
      aria-label={`Reply to ${shop}`}
      onSubmit={(e) => {
        // No-op: realtime send is handled by socket.io elsewhere.
        e.preventDefault();
      }}
    >
      <label htmlFor="inbox-reply-body" className="sr-only">
        Reply message
      </label>
      <Textarea
        id="inbox-reply-body"
        placeholder="Write a reply…"
        value={draft}
        onValueChange={setDraft}
        rows={3}
        aria-label="Reply message"
        aria-describedby="inbox-reply-note"
      />
      <Flex justifyContent="between" alignItems="center" className="mt-2 gap-2">
        <Text
          id="inbox-reply-note"
          className="text-xs text-tremor-content-subtle"
          role="note"
        >
          Sending is handled in realtime over the live channel. Read-only viewers
          cannot reply.
        </Text>
        <Button type="submit" disabled aria-disabled="true">
          Send
        </Button>
      </Flex>
    </form>
  );
}

/** The selected-conversation detail pane (right): message stream + composer. */
function ConversationDetail({
  conversation,
}: {
  readonly conversation: Conversation;
}) {
  const historyQuery = trpc.chat.history.useQuery({
    conversationId: conversation.id,
  });

  return (
    <Card aria-label={`Conversation with ${conversation.shop}`}>
      <Flex justifyContent="between" alignItems="start" className="gap-2">
        <div>
          <Title>{conversation.shop}</Title>
          <Text className="mt-1 text-tremor-content-subtle">
            {conversation.assignedTo
              ? `Assigned to ${conversation.assignedTo}`
              : "Unassigned"}
          </Text>
        </div>
        <Badge
          color={STATUS_TONE[conversation.status]}
          aria-label={`Status ${STATUS_LABEL[conversation.status]}`}
        >
          {STATUS_LABEL[conversation.status]}
        </Badge>
      </Flex>

      <Divider className="my-3" />

      {historyQuery.isLoading ? (
        <Text role="status" aria-busy="true">
          Loading messages…
        </Text>
      ) : historyQuery.isError ? (
        <div role="alert" aria-label="Message history load error">
          <Text>Couldn't load this conversation.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            {historyQuery.error.message}
          </Text>
        </div>
      ) : (historyQuery.data ?? []).length === 0 ? (
        <Text role="status" className="text-tremor-content-subtle">
          No messages in this conversation yet.
        </Text>
      ) : (
        <ul
          className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto"
          aria-label="Message history"
        >
          {(historyQuery.data ?? []).map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </ul>
      )}

      <Divider className="my-3" />

      <ReplyComposer shop={conversation.shop} />
    </Card>
  );
}

export default function Inbox() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("OPEN");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Re-read the active list so the detail pane can resolve the selected row's
  // metadata (status/shop/assignment) without a second per-conversation query.
  const conversationsQuery = trpc.chat.conversations.useQuery(
    statusFilter === "ALL" ? {} : { status: statusFilter },
  );

  const selected =
    (conversationsQuery.data ?? []).find((c) => c.id === selectedId) ?? null;

  return (
    <main className="p-6" aria-label="Agent inbox">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Inbox</Title>
        {conversationsQuery.data ? (
          <AsOf iso={new Date().toISOString()} />
        ) : null}
      </Flex>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr]">
        <ConversationList
          statusFilter={statusFilter}
          onStatusFilterChange={(next) => {
            setStatusFilter(next);
            setSelectedId(null);
          }}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {selected ? (
          <ConversationDetail conversation={selected} />
        ) : (
          <Card aria-label="No conversation selected">
            <div role="status" className="py-12 text-center">
              <Title className="text-tremor-content">No conversation selected</Title>
              <Text className="mt-2 text-tremor-content-subtle">
                Choose a conversation from the list to view its messages.
              </Text>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
