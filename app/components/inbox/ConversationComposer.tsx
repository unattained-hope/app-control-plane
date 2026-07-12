import { useEffect, useRef, useState } from "react";
import type { Role } from "@prisma/client";
import { Button, Flex, Text, Textarea } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";
import { useAgentChatSocket } from "~/lib/agentChatSocket.js";
import type { ComposerTab } from "./types.js";

const TYPING_IDLE_MS = 2500;

export function ConversationComposer({
  conversationId,
  canReply,
  activeTab,
  onTabChange,
  draft,
  onDraftChange,
  onPosted,
}: {
  readonly conversationId: string;
  readonly canReply: boolean;
  readonly activeTab: ComposerTab;
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly onTabChange: (tab: ComposerTab) => void;
  readonly onPosted: () => void;
}) {
  const { sendReply, replyError, clearReplyError, connected, setTyping } = useAgentChatSocket();
  const [sending, setSending] = useState(false);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postNote = trpc.chat.postInternalNote.useMutation({
    onSuccess: () => {
      onDraftChange("");
      onPosted();
    },
  });

  useEffect(() => {
    clearReplyError();
  }, [conversationId, activeTab, clearReplyError]);

  useEffect(() => {
    return () => {
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
      setTyping(conversationId, false);
    };
  }, [conversationId, setTyping]);

  useEffect(() => {
    if (activeTab !== "reply") {
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
      setTyping(conversationId, false);
    }
  }, [activeTab, conversationId, setTyping]);

  function stopTyping(): void {
    if (typingIdleRef.current) {
      clearTimeout(typingIdleRef.current);
      typingIdleRef.current = null;
    }
    setTyping(conversationId, false);
  }

  function scheduleTypingStop(): void {
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    typingIdleRef.current = setTimeout(() => {
      typingIdleRef.current = null;
      setTyping(conversationId, false);
    }, TYPING_IDLE_MS);
  }

  function handleDraftChange(next: string): void {
    onDraftChange(next);

    if (activeTab !== "reply") return;

    if (next.trim()) {
      setTyping(conversationId, true);
      scheduleTypingStop();
      return;
    }

    stopTyping();
  }

  if (!canReply) {
    return (
      <div className="apoaap-inbox-composer apoaap-inbox-composer-readonly" role="status">
        <Text className="text-sm text-tremor-content">
          You have view-only access — replies and internal notes are disabled.
        </Text>
      </div>
    );
  }

  const placeholder =
    activeTab === "reply"
      ? "Write a reply to the merchant…"
      : "Internal note — visible to agents only…";

  const submitLabel = activeTab === "reply" ? "Send reply" : "Add internal note";
  const isPending = activeTab === "reply" ? sending : postNote.isPending;
  const errorMessage =
    activeTab === "reply" ? replyError : postNote.isError ? postNote.error.message : null;

  function submitDraft() {
    const body = draft.trim();
    if (!body || isPending) return;

    if (activeTab === "reply") {
      setSending(true);
      stopTyping();
      sendReply(conversationId, body);
      onDraftChange("");
      onPosted();
      setSending(false);
      return;
    }

    postNote.mutate({ conversationId, body });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitDraft();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitDraft();
    }
  }

  function handleTabChange(tab: ComposerTab): void {
    if (tab !== "reply") stopTyping();
    onTabChange(tab);
  }

  return (
    <form className="apoaap-inbox-composer" aria-label="Message composer" onSubmit={handleSubmit}>
      <div className="apoaap-inbox-composer-tabs" role="tablist" aria-label="Composer mode">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "reply"}
          className={activeTab === "reply" ? "is-active" : undefined}
          onClick={() => handleTabChange("reply")}
        >
          Reply
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "note"}
          className={activeTab === "note" ? "is-active" : undefined}
          onClick={() => handleTabChange("note")}
        >
          Internal note
        </button>
      </div>

      <label htmlFor="inbox-composer-body" className="sr-only">
        {activeTab === "reply" ? "Reply to merchant" : "Internal note (agent-only)"}
      </label>
      <Textarea
        id="inbox-composer-body"
        placeholder={placeholder}
        value={draft}
        onValueChange={handleDraftChange}
        onKeyDown={handleKeyDown}
        rows={3}
        aria-label={activeTab === "reply" ? "Reply body" : "Internal note body"}
      />

      {errorMessage ? (
        <Text className="apoaap-inbox-composer-error" role="alert">
          {errorMessage}
        </Text>
      ) : null}

      <Flex justifyContent="between" alignItems="center" className="apoaap-inbox-composer-actions">
        <Text className="text-xs text-tremor-content-subtle">
          {activeTab === "reply" && !connected ? "Connecting…" : "Ctrl+Enter to send"}
        </Text>
        <Button size="sm" type="submit" disabled={!draft.trim() || isPending}>
          {submitLabel}
        </Button>
      </Flex>
    </form>
  );
}

export function canCompose(role: Role): boolean {
  return role === "ADMIN" || role === "SUPPORT";
}
