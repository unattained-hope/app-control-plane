import { Badge, Divider, Text, Title } from "@tremor/react";
import { Pin, Search } from "lucide-react";
import { StoreAvatar } from "~/components/StoreAvatar.js";
import type { Conversation, StatusFilter } from "./types.js";
import {
  PRIORITY_TONE,
  SLA_LABEL,
  SLA_TONE,
  STATUS_LABEL,
  countdownLabel,
  formatRelativeTimestamp,
  formatShopLabel,
  formatTimestamp,
} from "./format.js";

function ShopHeading({
  shop,
  size = "md",
}: {
  readonly shop: string;
  readonly size?: "sm" | "md";
}) {
  const label = formatShopLabel(shop);
  const titleClass = size === "sm" ? "apoaap-inbox-shop-title is-sm" : "apoaap-inbox-shop-title";
  return (
    <div className="min-w-0">
      <p className={`truncate ${titleClass}`} title={shop}>
        {label}
      </p>
      {label !== shop ? (
        <p className="apoaap-inbox-shop-domain truncate" title={shop}>
          {shop}
        </p>
      ) : null}
    </div>
  );
}

function ConversationStatus({ status }: { readonly status: Conversation["status"] }) {
  const dotClass: Readonly<Record<Conversation["status"], string>> = {
    OPEN: "is-open",
    SNOOZED: "is-snoozed",
    CLOSED: "is-closed",
  };
  return (
    <span className="apoaap-inbox-status" aria-label={`Status ${STATUS_LABEL[status]}`}>
      <span className={`apoaap-inbox-status-dot ${dotClass[status]}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

function SlaChips({ conversation }: { readonly conversation: Conversation }) {
  const due = conversation.firstReplyAt
    ? conversation.resolutionDueAt
    : conversation.firstResponseDueAt;
  const countdown = conversation.priority === "NONE" ? null : countdownLabel(due);
  return (
    <div className="apoaap-inbox-sla-chips">
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
      {countdown ? <span className="apoaap-inbox-sla-countdown">{countdown}</span> : null}
    </div>
  );
}

function ConversationListItem({
  conversation,
  selected,
  onSelect,
  onTogglePin,
}: {
  readonly conversation: Conversation;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly onTogglePin?: (id: string, pinned: boolean) => void;
}) {
  const hasUnread = conversation.unreadCount > 0;
  return (
    <li className="relative group list-none">
      <div
        onClick={() => onSelect(conversation.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(conversation.id);
          }
        }}
        aria-pressed={selected}
        aria-label={`Conversation with ${conversation.shop}, ${STATUS_LABEL[conversation.status]}, priority ${conversation.priority}, ${conversation.unreadCount} unread`}
        className={selected ? "apoaap-inbox-list-item is-selected" : "apoaap-inbox-list-item"}
      >
        <div className="apoaap-inbox-list-item-top">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <StoreAvatar shop={conversation.shop} size="sm" />
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {conversation.pinned ? (
                <span className="apoaap-inbox-pin-badge" title="Pinned conversation" aria-label="Pinned conversation">
                  <Pin size={11} className="fill-current text-amber-500 shrink-0" aria-hidden="true" />
                </span>
              ) : null}
              <ShopHeading shop={conversation.shop} size="sm" />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onTogglePin ? (
              <button
                type="button"
                className={`apoaap-inbox-item-pin-btn ${conversation.pinned ? "is-pinned" : ""}`}
                title={conversation.pinned ? "Unpin conversation" : "Pin conversation"}
                aria-label={conversation.pinned ? "Unpin conversation" : "Pin conversation"}
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(conversation.id, !conversation.pinned);
                }}
              >
                <Pin size={12} className={conversation.pinned ? "fill-current" : undefined} aria-hidden="true" />
              </button>
            ) : null}
            {hasUnread ? (
              <Badge
                color="rose"
                className="shrink-0"
                aria-label={`${conversation.unreadCount} unread messages`}
              >
                {conversation.unreadCount}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="mt-1">
          <SlaChips conversation={conversation} />
        </div>
        <div className="apoaap-inbox-list-item-meta">
          <ConversationStatus status={conversation.status} />
          <span className="apoaap-inbox-list-time">
            {conversation.lastMessageAt ? (
              <time dateTime={conversation.lastMessageAt} title={formatTimestamp(conversation.lastMessageAt)}>
                {formatRelativeTimestamp(conversation.lastMessageAt)}
              </time>
            ) : (
              "No messages yet"
            )}
          </span>
        </div>
        {conversation.assignedTo ? (
          <span className="apoaap-inbox-list-assigned">Assigned to {conversation.assignedTo}</span>
        ) : null}
      </div>
    </li>
  );
}

export function ConversationList({
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
  onTogglePin,
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
  readonly onTogglePin?: (id: string, pinned: boolean) => void;
}) {
  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: "ALL", label: "All" },
    { value: "OPEN", label: "Open" },
    { value: "SNOOZED", label: "Snoozed" },
    { value: "CLOSED", label: "Closed" },
  ];

  return (
    <aside className="apoaap-inbox-list" aria-label="Conversations">
      <div className="flex items-center justify-between mb-3">
        <Title className="apoaap-inbox-list-heading">Inbox</Title>
        <span className="px-2 py-0.5 text-xs font-mono font-semibold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          {conversations.filter((c) => c.status === "OPEN").length} active
        </span>
      </div>

      <div className="apoaap-inbox-list-search">
        <label htmlFor="inbox-search" className="sr-only">
          Search conversations
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-cp-text-subtle">
            <Search size={14} />
          </div>
          <input
            id="inbox-search"
            type="search"
            placeholder="Search shop, subject, tag, or message…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search conversations"
            className="apoaap-inbox-search-input pl-9"
          />
        </div>
      </div>

      {/* Segmented Pill Tabs */}
      <div className="apoaap-inbox-pill-tabs" role="tablist" aria-label="Filter status">
        {statusOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={statusFilter === opt.value}
            className={`apoaap-inbox-pill-tab ${statusFilter === opt.value ? "is-active" : ""}`}
            onClick={() => onStatusFilterChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <Divider className="apoaap-inbox-list-divider" />

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
        <Text role="status" className="text-tremor-content">
          No conversations match this filter.
        </Text>
      ) : (
        <ul className="apoaap-inbox-list-items" aria-label="Conversation list">
          {conversations.map((c) => (
            <ConversationListItem
              key={c.id}
              conversation={c}
              selected={c.id === selectedId}
              onSelect={onSelect}
              onTogglePin={onTogglePin}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
