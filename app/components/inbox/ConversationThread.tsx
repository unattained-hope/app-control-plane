import { useEffect, useRef } from "react";
import type { Role } from "@prisma/client";
import { Text } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";
import { useAgentChatSocket } from "~/lib/agentChatSocket.js";
import type { ChatMessage, ComposerTab, Conversation } from "./types.js";
import {
  PRIORITY_TONE,
  SLA_LABEL,
  SLA_TONE,
  STATUS_LABEL,
  countdownLabel,
  dateKey,
  formatShopLabel,
} from "./format.js";
import { MessageBubble } from "./MessageBubble.js";
import { MessageDateDivider, messageDateDividerLabel } from "./MessageDateDivider.js";
import { ConversationComposer, canCompose } from "./ConversationComposer.js";

function ShopHeading({ shop }: { readonly shop: string }) {
  const label = formatShopLabel(shop);
  return (
    <div className="min-w-0">
      <h2 className="apoaap-inbox-thread-title truncate" title={shop}>
        {label}
      </h2>
      {label !== shop ? (
        <p className="apoaap-inbox-thread-domain truncate" title={shop}>
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
        <span className={`apoaap-inbox-priority-chip is-${PRIORITY_TONE[conversation.priority]}`}>
          {conversation.priority}
        </span>
      ) : null}
      {conversation.priority !== "NONE" ? (
        <span className={`apoaap-inbox-sla-chip is-${SLA_TONE[conversation.slaState]}`}>
          {SLA_LABEL[conversation.slaState]}
        </span>
      ) : null}
      {countdown ? <span className="apoaap-inbox-sla-countdown">{countdown}</span> : null}
    </div>
  );
}

function groupMessagesWithDividers(messages: readonly ChatMessage[]) {
  const items: Array<{ kind: "divider"; label: string; key: string } | { kind: "message"; message: ChatMessage }> =
    [];
  let lastDateKey: string | null = null;

  for (const message of messages) {
    const key = dateKey(message.createdAt);
    if (key !== lastDateKey) {
      items.push({
        kind: "divider",
        label: messageDateDividerLabel(message.createdAt),
        key: `divider-${key}`,
      });
      lastDateKey = key;
    }
    items.push({ kind: "message", message });
  }

  return items;
}

export function ConversationThread({
  conversation,
  role,
  composerTab,
  onComposerTabChange,
  draft,
  onDraftChange,
  onRefresh,
}: {
  readonly conversation: Conversation;
  readonly role: Role;
  readonly composerTab: ComposerTab;
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly onComposerTabChange: (tab: ComposerTab) => void;
  readonly onRefresh: () => void;
}) {
  const { joinConversation } = useAgentChatSocket();
  const scrollAnchorRef = useRef<HTMLLIElement>(null);
  const historyQuery = trpc.chat.history.useQuery({ conversationId: conversation.id });
  const messages = historyQuery.data ?? [];

  useEffect(() => {
    joinConversation(conversation.id);
  }, [conversation.id, joinConversation]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversation.id]);

  const grouped = groupMessagesWithDividers(messages);

  return (
    <section className="apoaap-inbox-thread" aria-label={`Conversation with ${conversation.shop}`}>
      <header className="apoaap-inbox-thread-header">
        <div className="apoaap-inbox-thread-header-main">
          <ShopHeading shop={conversation.shop} />
          <div className="apoaap-inbox-thread-meta">
            <ConversationStatus status={conversation.status} />
            <Text className="text-sm text-tremor-content">
              {conversation.assignedTo ? `Assigned to ${conversation.assignedTo}` : "Unassigned"}
            </Text>
          </div>
          <SlaChips conversation={conversation} />
        </div>
        {conversation.csatScore != null ? (
          <div className="apoaap-inbox-csat" aria-label={`CSAT score ${conversation.csatScore} of 5`}>
            CSAT: {conversation.csatScore}/5
          </div>
        ) : null}
      </header>

      <div className="apoaap-inbox-thread-messages" aria-label="Message history">
        {historyQuery.isLoading ? (
          <Text role="status" aria-busy="true">
            Loading messages…
          </Text>
        ) : historyQuery.isError ? (
          <div role="alert" aria-label="Message history load error">
            <Text>Couldn't load this conversation.</Text>
            <Text className="mt-1 text-xs text-tremor-content">{historyQuery.error.message}</Text>
          </div>
        ) : messages.length === 0 ? (
          <Text role="status" className="text-tremor-content">
            No messages in this conversation yet.
          </Text>
        ) : (
          <ul className="apoaap-inbox-message-list">
            {grouped.map((item) =>
              item.kind === "divider" ? (
                <MessageDateDivider key={item.key} label={item.label} />
              ) : (
                <MessageBubble key={item.message.id} message={item.message} shop={conversation.shop} />
              ),
            )}
            <li ref={scrollAnchorRef} className="apoaap-inbox-scroll-anchor" aria-hidden />
          </ul>
        )}
      </div>

      <ConversationComposer
        conversationId={conversation.id}
        canReply={canCompose(role)}
        activeTab={composerTab}
        onTabChange={onComposerTabChange}
        draft={draft}
        onDraftChange={onDraftChange}
        onPosted={onRefresh}
      />
    </section>
  );
}
