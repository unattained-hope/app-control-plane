import { useMemo, useState } from "react";
import { Flex, Text, Title } from "@tremor/react";
import { useOutletContext } from "react-router";
import { trpc } from "~/lib/trpc.js";
import type { ShellOutletContext } from "~/routes/_shell.js";
import { ConversationList } from "~/components/inbox/ConversationList.js";
import { ConversationThread } from "~/components/inbox/ConversationThread.js";
import { ConversationSidebar } from "~/components/inbox/ConversationSidebar.js";
import type { ComposerTab, Conversation, StatusFilter } from "~/components/inbox/types.js";
import { formatTimestamp } from "~/components/inbox/format.js";

/**
 * Agent inbox (cp-support-inbox + Tier 1).
 *
 * Three-column layout: conversation list, message thread with Reply/Note composer,
 * and triage sidebar. Merchant replies go over Socket.IO (`agent:reply`); internal
 * notes and triage controls use tRPC.
 */
export default function Inbox() {
  const { role, userId } = useOutletContext<ShellOutletContext>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("OPEN");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerTab, setComposerTab] = useState<ComposerTab>("reply");
  const [draft, setDraft] = useState("");
  const utils = trpc.useUtils();

  const searchQuery = trpc.chat.search.useQuery(
    {
      query: search.trim() || undefined,
      status: statusFilter === "ALL" ? undefined : statusFilter,
      page: 1,
      pageSize: 50,
    },
    { refetchInterval: 30_000 },
  );

  const conversations: readonly Conversation[] = useMemo(
    () => searchQuery.data?.rows ?? [],
    [searchQuery.data],
  );
  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const refresh = () => {
    if (!selected) return;
    void utils.chat.history.invalidate({ conversationId: selected.id });
    void utils.chat.conversations.invalidate();
    void utils.chat.search.invalidate();
    void utils.chat.unreadTotal.invalidate();
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setDraft("");
    setComposerTab("reply");
  };

  const handleInsertCanned = (body: string) => {
    setDraft(body);
    setComposerTab("reply");
  };

  return (
    <div className="apoaap-inbox-page" aria-label="Agent inbox">
      <Flex justifyContent="between" alignItems="baseline" className="apoaap-inbox-page-header">
        <Title>Inbox</Title>
        {searchQuery.data ? (
          <Text className="shrink-0 text-xs text-tremor-content">
            as of <time dateTime={new Date().toISOString()}>{formatTimestamp(new Date().toISOString())}</time>
          </Text>
        ) : null}
      </Flex>

      <div className="apoaap-inbox-grid">
        <ConversationList
          statusFilter={statusFilter}
          onStatusFilterChange={(next) => {
            setStatusFilter(next);
            setSelectedId(null);
            setDraft("");
          }}
          search={search}
          onSearchChange={setSearch}
          conversations={conversations}
          isLoading={searchQuery.isLoading}
          isError={searchQuery.isError}
          errorMessage={searchQuery.error?.message}
          selectedId={selectedId}
          onSelect={handleSelect}
        />

        {selected ? (
          <>
            <ConversationThread
              conversation={selected}
              role={role}
              composerTab={composerTab}
              onComposerTabChange={setComposerTab}
              draft={draft}
              onDraftChange={setDraft}
              onRefresh={refresh}
            />
            <ConversationSidebar
              conversation={selected}
              userId={userId}
              role={role}
              onChanged={refresh}
              onInsertCanned={handleInsertCanned}
            />
          </>
        ) : (
          <div className="apoaap-inbox-empty" role="status">
            <Title className="text-tremor-content">No conversation selected</Title>
            <Text className="mt-2 text-tremor-content">
              Choose a conversation from the list to view its messages.
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
