import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Divider,
  Flex,
  Select,
  SelectItem,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@tremor/react";
import { trpc } from "~/lib/trpc.js";

/**
 * Agent inbox (cp-support-inbox + Tier 1).
 *
 * Left pane: conversation search/list (`trpc.chat.search`) with per-row priority +
 * SLA countdown chips (cp-inbox-sla). Right pane: the message stream
 * (`trpc.chat.history`, including internal notes rendered distinctly), a priority
 * control, a canned-reply picker, conversation tags, an internal-note composer, and
 * any captured CSAT. Realtime send remains the socket.io path; this route owns the
 * non-realtime inbox operations + presentation.
 */

type ConversationStatus = "OPEN" | "SNOOZED" | "CLOSED";
type StatusFilter = "ALL" | ConversationStatus;
type SenderType = "MERCHANT" | "AGENT" | "SYSTEM";
type Priority = "URGENT" | "HIGH" | "NORMAL" | "LOW" | "NONE";
type SlaState = "ON_TRACK" | "BREACHING" | "BREACHED" | "MET";

interface Conversation {
  readonly id: string;
  readonly shop: string;
  readonly status: ConversationStatus;
  readonly assignedTo: string | null;
  readonly priority: Priority;
  readonly slaState: SlaState;
  readonly firstReplyAt: string | null;
  readonly firstResponseDueAt: string | null;
  readonly resolutionDueAt: string | null;
  readonly csatScore: number | null;
  readonly unreadCount: number;
  readonly lastMessageAt: string | null;
}

interface ChatMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderType: SenderType;
  readonly senderId: string;
  readonly body: string;
  readonly internal: boolean;
  readonly attachmentUrl: string | null;
  readonly createdAt: string;
}

const STATUS_FILTERS: ReadonlyArray<{ readonly value: StatusFilter; readonly label: string }> = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "SNOOZED", label: "Snoozed" },
  { value: "CLOSED", label: "Closed" },
];

const STATUS_TONE: Readonly<Record<ConversationStatus, "emerald" | "amber" | "gray">> = {
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

const PRIORITIES: readonly Priority[] = ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"];

const PRIORITY_TONE: Readonly<Record<Priority, "rose" | "orange" | "blue" | "gray">> = {
  URGENT: "rose",
  HIGH: "orange",
  NORMAL: "blue",
  LOW: "gray",
  NONE: "gray",
};

const SLA_TONE: Readonly<Record<SlaState, "emerald" | "amber" | "rose" | "gray">> = {
  ON_TRACK: "gray",
  BREACHING: "amber",
  BREACHED: "rose",
  MET: "emerald",
};

const SLA_LABEL: Readonly<Record<SlaState, string>> = {
  ON_TRACK: "On track",
  BREACHING: "Breaching",
  BREACHED: "Breached",
  MET: "Met",
};

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

/** Compact countdown ("in 3h 12m" / "overdue 45m") toward an ISO due-time. */
function countdownLabel(dueIso: string | null): string | null {
  if (!dueIso) return null;
  const due = Date.parse(dueIso);
  if (Number.isNaN(due)) return null;
  const diffMin = Math.round((due - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return diffMin >= 0 ? `due in ${span}` : `overdue ${span}`;
}

function AsOf({ iso }: { readonly iso: string }) {
  return (
    <Text className="text-xs text-tremor-content-subtle">
      as of <time dateTime={iso}>{formatTimestamp(iso)}</time>
    </Text>
  );
}

/** Priority + SLA chips shown on a conversation row and in the detail header. */
function SlaChips({ conversation }: { readonly conversation: Conversation }) {
  const due = conversation.firstReplyAt
    ? conversation.resolutionDueAt
    : conversation.firstResponseDueAt;
  const countdown = conversation.priority === "NONE" ? null : countdownLabel(due);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {conversation.priority !== "NONE" ? (
        <Badge color={PRIORITY_TONE[conversation.priority]} aria-label={`Priority ${conversation.priority}`}>
          {conversation.priority}
        </Badge>
      ) : null}
      {conversation.priority !== "NONE" ? (
        <Badge color={SLA_TONE[conversation.slaState]} aria-label={`SLA ${SLA_LABEL[conversation.slaState]}`}>
          {SLA_LABEL[conversation.slaState]}
        </Badge>
      ) : null}
      {countdown ? (
        <Text className="text-xs text-tremor-content-subtle">{countdown}</Text>
      ) : null}
    </div>
  );
}

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
        aria-label={`Conversation with ${conversation.shop}, ${STATUS_LABEL[conversation.status]}, priority ${conversation.priority}, ${conversation.unreadCount} unread`}
        className={
          selected
            ? "w-full rounded border border-tremor-brand bg-tremor-brand-faint px-3 py-2 text-left"
            : "w-full rounded border border-tremor-border bg-tremor-background px-3 py-2 text-left hover:bg-tremor-background-muted"
        }
      >
        <Flex justifyContent="between" alignItems="start">
          <Text className="font-medium text-tremor-content-strong">{conversation.shop}</Text>
          {hasUnread ? (
            <Badge color="rose" aria-label={`${conversation.unreadCount} unread messages`}>
              {conversation.unreadCount}
            </Badge>
          ) : null}
        </Flex>
        <div className="mt-1">
          <SlaChips conversation={conversation} />
        </div>
        <Flex justifyContent="between" alignItems="center" className="mt-1 gap-2">
          <Badge color={STATUS_TONE[conversation.status]} aria-label={`Status ${STATUS_LABEL[conversation.status]}`}>
            {STATUS_LABEL[conversation.status]}
          </Badge>
          <Text className="text-xs text-tremor-content-subtle">
            {conversation.lastMessageAt ? (
              <time dateTime={conversation.lastMessageAt}>{formatTimestamp(conversation.lastMessageAt)}</time>
            ) : (
              "No messages yet"
            )}
          </Text>
        </Flex>
        {conversation.assignedTo ? (
          <Text className="mt-1 text-xs text-tremor-content-subtle">Assigned to {conversation.assignedTo}</Text>
        ) : null}
      </button>
    </li>
  );
}

function ConversationList({
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  conversations,
  isLoading,
  isError,
  errorMessage,
  selectedId,
  onSelect,
}: {
  readonly statusFilter: StatusFilter;
  readonly onStatusFilterChange: (next: StatusFilter) => void;
  readonly search: string;
  readonly onSearchChange: (next: string) => void;
  readonly conversations: readonly Conversation[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage?: string;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <Card aria-label="Conversations">
      <Title>Conversations</Title>

      <div className="mt-3">
        <label htmlFor="inbox-search" className="sr-only">
          Search conversations
        </label>
        <input
          id="inbox-search"
          type="search"
          placeholder="Search shop, subject, tag, or message…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search conversations"
          className="w-full rounded-tremor-default border border-tremor-border bg-tremor-background px-3 py-2 text-sm text-tremor-content placeholder-tremor-content-subtle focus:outline-none focus:ring-2 focus:ring-tremor-brand"
        />
      </div>

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

      {isLoading ? (
        <Text role="status" aria-busy="true">
          Loading conversations…
        </Text>
      ) : isError ? (
        <div role="alert" aria-label="Conversation load error">
          <Text>Couldn't load conversations.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">{errorMessage}</Text>
        </div>
      ) : conversations.length === 0 ? (
        <Text role="status" className="text-tremor-content-subtle">
          No conversations match this filter.
        </Text>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Conversation list">
          {conversations.map((c) => (
            <ConversationListItem key={c.id} conversation={c} selected={c.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MessageBubble({ message }: { readonly message: ChatMessage }) {
  if (message.internal) {
    return (
      <li
        className="mx-auto w-full rounded border border-amber-300 bg-amber-50 px-3 py-2"
        aria-label="Internal note"
      >
        <Flex justifyContent="between" alignItems="baseline" className="gap-3">
          <Text className="text-xs font-medium text-amber-800">
            Internal note
            <span className="text-amber-700"> · {message.senderId}</span>
          </Text>
          <Text className="text-xs text-amber-700">
            <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
          </Text>
        </Flex>
        <Text className="mt-1 whitespace-pre-wrap text-amber-900">{message.body}</Text>
      </li>
    );
  }

  const alignClass =
    message.senderType === "AGENT"
      ? "ml-auto bg-tremor-brand-faint border-tremor-brand"
      : message.senderType === "SYSTEM"
        ? "mx-auto bg-tremor-background-muted border-tremor-border italic"
        : "mr-auto bg-tremor-background border-tremor-border";

  return (
    <li className={`max-w-[80%] rounded border px-3 py-2 ${alignClass}`} aria-label={`${SENDER_LABEL[message.senderType]} message`}>
      <Flex justifyContent="between" alignItems="baseline" className="gap-3">
        <Text className="text-xs font-medium text-tremor-content-strong">
          {SENDER_LABEL[message.senderType]}
          <span className="text-tremor-content-subtle"> · {message.senderId}</span>
        </Text>
        <Text className="text-xs text-tremor-content-subtle">
          <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
        </Text>
      </Flex>
      <Text className="mt-1 whitespace-pre-wrap text-tremor-content-strong">{message.body}</Text>
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

/** Priority control — sets priority server-side (recomputes SLA due-times). */
function PrioritySelect({
  conversation,
  onChanged,
}: {
  readonly conversation: Conversation;
  readonly onChanged: () => void;
}) {
  const setPriority = trpc.chat.setPriority.useMutation({ onSuccess: onChanged });
  return (
    <div>
      <label htmlFor="inbox-priority" className="sr-only">
        Set priority
      </label>
      <Select
        id="inbox-priority"
        value={conversation.priority}
        onValueChange={(v) =>
          setPriority.mutate({ conversationId: conversation.id, priority: v as Priority })
        }
        aria-label="Set conversation priority"
        enableClear={false}
      >
        {PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            {p}
          </SelectItem>
        ))}
      </Select>
      {setPriority.isError ? (
        <Text className="mt-1 text-xs text-rose-600" role="alert">
          {setPriority.error.message}
        </Text>
      ) : null}
    </div>
  );
}

/** Canned-reply picker: search shortcuts, preview the substituted body. */
function CannedReplyPicker({ shop }: { readonly shop: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listQuery = trpc.canned.list.useQuery();
  const applyQuery = trpc.canned.render.useQuery(
    { id: selectedId ?? "", shop },
    { enabled: selectedId !== null },
  );

  const replies = listQuery.data ?? [];

  return (
    <div aria-label="Canned replies">
      <Text className="text-xs font-medium text-tremor-content-strong">Canned replies</Text>
      {replies.length === 0 ? (
        <Text className="mt-1 text-xs text-tremor-content-subtle">No canned replies yet.</Text>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1">
          {replies.map((r) => (
            <Button
              key={r.id}
              size="xs"
              variant="secondary"
              type="button"
              onClick={() => setSelectedId(r.id)}
              aria-label={`Insert canned reply ${r.shortcut}`}
            >
              {r.shortcut}
            </Button>
          ))}
        </div>
      )}
      {selectedId && applyQuery.data ? (
        <Textarea
          className="mt-2"
          readOnly
          value={applyQuery.data.body}
          rows={3}
          aria-label="Canned reply preview (substituted)"
        />
      ) : null}
    </div>
  );
}

/** Conversation tags: add/remove (reply-gated). */
function ConversationTags({
  conversationId,
}: {
  readonly conversationId: string;
}) {
  const [label, setLabel] = useState("");
  const utils = trpc.useUtils();
  const tagsQuery = trpc.chat.tags.useQuery({ conversationId });
  const invalidate = () => void utils.chat.tags.invalidate({ conversationId });
  const addTag = trpc.chat.addTag.useMutation({
    onSuccess: () => {
      setLabel("");
      invalidate();
    },
  });
  const removeTag = trpc.chat.removeTag.useMutation({ onSuccess: invalidate });

  const tags = tagsQuery.data ?? [];

  return (
    <div aria-label="Conversation tags">
      <Text className="text-xs font-medium text-tremor-content-strong">Tags</Text>
      <div className="mt-1 flex flex-wrap gap-1">
        {tags.length === 0 ? (
          <Text className="text-xs text-tremor-content-subtle">No tags.</Text>
        ) : (
          tags.map((t) => (
            <Badge key={t} aria-label={`Tag ${t}`}>
              {t}
              <button
                type="button"
                className="ml-1"
                aria-label={`Remove tag ${t}`}
                onClick={() => removeTag.mutate({ conversationId, label: t })}
              >
                ×
              </button>
            </Badge>
          ))
        )}
      </div>
      <form
        className="mt-2 flex gap-2"
        aria-label="Add conversation tag"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          addTag.mutate({ conversationId, label: label.trim() });
        }}
      >
        <TextInput placeholder="Add tag…" value={label} onValueChange={setLabel} aria-label="Tag label" />
        <Button size="xs" type="submit" disabled={!label.trim() || addTag.isPending}>
          Add
        </Button>
      </form>
    </div>
  );
}

/** Internal-note composer (agent-only; never delivered to the merchant). */
function InternalNoteComposer({
  conversationId,
  onPosted,
}: {
  readonly conversationId: string;
  readonly onPosted: () => void;
}) {
  const [body, setBody] = useState("");
  const post = trpc.chat.postInternalNote.useMutation({
    onSuccess: () => {
      setBody("");
      onPosted();
    },
  });
  return (
    <form
      aria-label="Add internal note"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        post.mutate({ conversationId, body: body.trim() });
      }}
    >
      <label htmlFor="inbox-internal-note" className="sr-only">
        Internal note (agent-only)
      </label>
      <Textarea
        id="inbox-internal-note"
        placeholder="Internal note — visible to agents only…"
        value={body}
        onValueChange={setBody}
        rows={2}
        aria-label="Internal note body"
      />
      <Flex justifyContent="end" className="mt-1">
        <Button size="xs" type="submit" variant="secondary" disabled={!body.trim() || post.isPending}>
          Add internal note
        </Button>
      </Flex>
    </form>
  );
}

function ConversationDetail({ conversation }: { readonly conversation: Conversation }) {
  const historyQuery = trpc.chat.history.useQuery({ conversationId: conversation.id });
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.chat.history.invalidate({ conversationId: conversation.id });
    void utils.chat.conversations.invalidate();
    void utils.chat.search.invalidate();
  };

  return (
    <Card aria-label={`Conversation with ${conversation.shop}`}>
      <Flex justifyContent="between" alignItems="start" className="gap-2">
        <div>
          <Title>{conversation.shop}</Title>
          <Text className="mt-1 text-tremor-content-subtle">
            {conversation.assignedTo ? `Assigned to ${conversation.assignedTo}` : "Unassigned"}
          </Text>
          <div className="mt-1">
            <SlaChips conversation={conversation} />
          </div>
        </div>
        <Badge color={STATUS_TONE[conversation.status]} aria-label={`Status ${STATUS_LABEL[conversation.status]}`}>
          {STATUS_LABEL[conversation.status]}
        </Badge>
      </Flex>

      {conversation.csatScore != null ? (
        <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 px-2 py-1">
          <Text className="text-xs text-emerald-800" aria-label={`CSAT score ${conversation.csatScore} of 5`}>
            CSAT: {conversation.csatScore}/5
          </Text>
        </div>
      ) : null}

      <Divider className="my-3" />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PrioritySelect conversation={conversation} onChanged={refresh} />
        <ConversationTags conversationId={conversation.id} />
      </div>

      <Divider className="my-3" />
      <CannedReplyPicker shop={conversation.shop} />

      <Divider className="my-3" />

      {historyQuery.isLoading ? (
        <Text role="status" aria-busy="true">
          Loading messages…
        </Text>
      ) : historyQuery.isError ? (
        <div role="alert" aria-label="Message history load error">
          <Text>Couldn't load this conversation.</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">{historyQuery.error.message}</Text>
        </div>
      ) : (historyQuery.data ?? []).length === 0 ? (
        <Text role="status" className="text-tremor-content-subtle">
          No messages in this conversation yet.
        </Text>
      ) : (
        <ul className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto" aria-label="Message history">
          {(historyQuery.data ?? []).map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </ul>
      )}

      <Divider className="my-3" />
      <InternalNoteComposer conversationId={conversation.id} onPosted={refresh} />
    </Card>
  );
}

export default function Inbox() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("OPEN");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const searchQuery = trpc.chat.search.useQuery({
    query: search.trim() || undefined,
    status: statusFilter === "ALL" ? undefined : statusFilter,
    page: 1,
    pageSize: 50,
  });

  const conversations: readonly Conversation[] = useMemo(
    () => searchQuery.data?.rows ?? [],
    [searchQuery.data],
  );
  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <main className="p-6" aria-label="Agent inbox">
      <Flex justifyContent="between" alignItems="baseline" className="mb-4">
        <Title>Inbox</Title>
        {searchQuery.data ? <AsOf iso={new Date().toISOString()} /> : null}
      </Flex>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
        <ConversationList
          statusFilter={statusFilter}
          onStatusFilterChange={(next) => {
            setStatusFilter(next);
            setSelectedId(null);
          }}
          search={search}
          onSearchChange={setSearch}
          conversations={conversations}
          isLoading={searchQuery.isLoading}
          isError={searchQuery.isError}
          errorMessage={searchQuery.error?.message}
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
