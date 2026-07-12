import { Badge, Divider, Select, SelectItem, Text, Title } from "@tremor/react";
import type { Conversation, StatusFilter } from "./types.js";
import {
  PRIORITY_TONE,
  SLA_LABEL,
  SLA_TONE,
  STATUS_FILTERS,
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
        className={selected ? "apoaap-inbox-list-item is-selected" : "apoaap-inbox-list-item"}
      >
        <div className="apoaap-inbox-list-item-top">
          <ShopHeading shop={conversation.shop} size="sm" />
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
      </button>
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
    <aside className="apoaap-inbox-list" aria-label="Conversations">
      <Title className="apoaap-inbox-list-heading">Conversations</Title>

      <div className="apoaap-inbox-list-search">
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
          className="apoaap-inbox-search-input"
        />
      </div>

      <div className="apoaap-inbox-list-filter">
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
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
