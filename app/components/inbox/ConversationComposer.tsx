import { useEffect, useRef, useState } from "react";
import type { Role } from "@prisma/client";
import { Text } from "@tremor/react";
import {
  Bold,
  ChevronDown,
  Code,
  FileText,
  Italic,
  List,
  Loader2,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { trpc } from "~/lib/trpc.js";
import { useAgentChatSocket } from "~/lib/agentChatSocket.js";
import type { ComposerTab } from "./types.js";
import { SlashCommandPicker } from "./SlashCommandPicker.js";

const TYPING_IDLE_MS = 2500;

export interface AttachedFile {
  readonly url: string;
  readonly filename: string;
  readonly size: number;
  readonly isImage: boolean;
}

type SendMode = "SEND" | "SEND_AND_CLOSE" | "SEND_AND_SNOOZE";

export function ConversationComposer({
  conversationId,
  shop,
  canReply,
  activeTab,
  onTabChange,
  draft,
  onDraftChange,
  onPosted,
}: {
  readonly conversationId: string;
  readonly shop: string;
  readonly canReply: boolean;
  readonly activeTab: ComposerTab;
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly onTabChange: (tab: ComposerTab) => void;
  readonly onPosted: () => void;
}) {
  const { sendReply, replyError, clearReplyError, connected, setTyping } = useAgentChatSocket();
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<AttachedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>("SEND");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const setStatus = trpc.chat.setStatus.useMutation();

  const postNote = trpc.chat.postInternalNote.useMutation({
    onSuccess: () => {
      onDraftChange("");
      setAttachment(null);
      onPosted();
    },
  });

  useEffect(() => {
    clearReplyError();
    setAttachment(null);
    setUploadError(null);
    setSlashOpen(false);
    setSendMenuOpen(false);
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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSendMenuOpen(false);
      }
    }
    if (sendMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [sendMenuOpen]);

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

  function detectSlashCommand(text: string, cursorPos: number) {
    const textBeforeCursor = text.substring(0, cursorPos);
    const lastSlashIdx = textBeforeCursor.lastIndexOf("/");
    if (lastSlashIdx !== -1) {
      const prevChar = textBeforeCursor[lastSlashIdx - 1];
      const isStart = lastSlashIdx === 0 || (prevChar !== undefined && /\s/.test(prevChar));
      const term = textBeforeCursor.substring(lastSlashIdx);
      if (isStart && !/\s/.test(term)) {
        setSlashQuery(term);
        setSlashOpen(true);
        return;
      }
    }
    setSlashOpen(false);
  }

  function handleDraftChange(next: string): void {
    onDraftChange(next);

    const cursorPos = textareaRef.current?.selectionStart ?? next.length;
    detectSlashCommand(next, cursorPos);

    if (activeTab !== "reply") return;

    if (next.trim()) {
      setTyping(conversationId, true);
      scheduleTypingStop();
      return;
    }

    stopTyping();
  }

  function applyFormatting(
    prefix: string,
    suffix: string = "",
    defaultText: string = "text",
    block: boolean = false,
  ) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selection = draft.substring(start, end);

    let insertion = "";
    let newCursorPos = start;

    if (block) {
      const isStartOfLine = start === 0 || draft[start - 1] === "\n";
      const preNewline = isStartOfLine ? "" : "\n";
      const postNewline = end === draft.length || draft[end] === "\n" ? "" : "\n";

      if (selection) {
        insertion = `${preNewline}${prefix}${selection}${suffix}${postNewline}`;
        newCursorPos = start + preNewline.length + prefix.length + selection.length + suffix.length;
      } else {
        insertion = `${preNewline}${prefix}${defaultText}${suffix}${postNewline}`;
        newCursorPos = start + preNewline.length + prefix.length;
      }
    } else {
      if (selection) {
        insertion = `${prefix}${selection}${suffix}`;
        newCursorPos = start + prefix.length + selection.length + suffix.length;
      } else {
        insertion = `${prefix}${defaultText}${suffix}`;
        newCursorPos = start + prefix.length;
      }
    }

    const nextValue = draft.substring(0, start) + insertion + draft.substring(end);
    onDraftChange(nextValue);

    setTimeout(() => {
      textarea.focus();
      if (!selection) {
        textarea.setSelectionRange(newCursorPos, newCursorPos + defaultText.length);
      } else {
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }

  async function handleFileUpload(file: File) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/chat/upload?conversationId=${encodeURIComponent(conversationId)}`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to upload file");
      }
      setAttachment({
        url: data.attachmentUrl,
        filename: data.filename || file.name,
        size: data.size || file.size,
        isImage: (data.mimeType || file.type).startsWith("image/"),
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileUpload(file);
    }
    e.target.value = "";
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void handleFileUpload(file);
          return;
        }
      }
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileUpload(file);
    }
  }

  function handleSelectCanned(body: string) {
    const textarea = textareaRef.current;
    const currentVal = draft;
    const cursorPos = textarea?.selectionStart ?? currentVal.length;
    const textBeforeCursor = currentVal.substring(0, cursorPos);
    const lastSlashIdx = textBeforeCursor.lastIndexOf("/");

    if (lastSlashIdx !== -1) {
      const prefix = currentVal.substring(0, lastSlashIdx);
      const suffix = currentVal.substring(cursorPos);
      const nextVal = prefix + body + (suffix.startsWith("\n") || !suffix ? "" : " ") + suffix;
      onDraftChange(nextVal);
    } else {
      onDraftChange(currentVal ? `${currentVal}\n${body}` : body);
    }

    setSlashOpen(false);
    setTimeout(() => {
      textarea?.focus();
    }, 0);
  }

  async function submitDraft(mode: SendMode = sendMode) {
    const body = draft.trim();
    if ((!body && !attachment) || isPending) return;

    if (activeTab === "reply") {
      setSending(true);
      stopTyping();
      sendReply(conversationId, body, attachment?.url ?? null);
      onDraftChange("");
      setAttachment(null);

      if (mode === "SEND_AND_CLOSE") {
        try {
          await setStatus.mutateAsync({ conversationId, status: "CLOSED" });
        } catch {
          // ignore error
        }
      } else if (mode === "SEND_AND_SNOOZE") {
        try {
          await setStatus.mutateAsync({ conversationId, status: "SNOOZED" });
        } catch {
          // ignore error
        }
      }

      onPosted();
      setSending(false);
      return;
    }

    postNote.mutate(
      {
        conversationId,
        body,
        attachmentUrl: attachment?.url ?? null,
      },
      {
        onSuccess: async () => {
          if (mode === "SEND_AND_CLOSE") {
            try {
              await setStatus.mutateAsync({ conversationId, status: "CLOSED" });
            } catch {
              // ignore
            }
          } else if (mode === "SEND_AND_SNOOZE") {
            try {
              await setStatus.mutateAsync({ conversationId, status: "SNOOZED" });
            } catch {
              // ignore
            }
          }
          onPosted();
        },
      },
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitDraft(sendMode);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape")) {
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        void submitDraft("SEND_AND_CLOSE");
      } else {
        void submitDraft(sendMode);
      }
    }
  }

  function handleTabChange(tab: ComposerTab): void {
    if (tab !== "reply") stopTyping();
    onTabChange(tab);
  }

  if (!canReply) {
    return (
      <div className="apoaap-inbox-composer-readonly" role="status">
        <Text className="text-sm text-tremor-content">
          You have view-only access — replies and internal notes are disabled.
        </Text>
      </div>
    );
  }

  const placeholder =
    activeTab === "reply"
      ? "Write a response... (Type '/' for templates, Ctrl+Enter to send)"
      : "Internal note — visible to agents only…";

  const isPending = activeTab === "reply" ? sending : postNote.isPending;
  const errorMessage =
    uploadError ?? (activeTab === "reply" ? replyError : postNote.isError ? postNote.error.message : null);

  const submitLabel =
    sendMode === "SEND_AND_CLOSE"
      ? activeTab === "reply"
        ? "Send & Close"
        : "Add note & Close"
      : sendMode === "SEND_AND_SNOOZE"
        ? activeTab === "reply"
        ? "Send & Snooze"
        : "Add note & Snooze"
      : activeTab === "reply"
        ? "Send reply"
        : "Add internal note";

  return (
    <div className="apoaap-inbox-composer-wrapper">
      <form
        className={`apoaap-inbox-composer apoaap-inbox-composer-card ${isDragging ? "is-dragover" : ""}`}
        aria-label="Message composer"
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={handleFileInputChange}
          aria-hidden="true"
        />

        <SlashCommandPicker
          shop={shop}
          query={slashQuery}
          isOpen={slashOpen}
          onSelect={handleSelectCanned}
          onClose={() => setSlashOpen(false)}
        />

        {/* Top bar: Mode Pills on Left, Formatting Actions on Right */}
        <div className="apoaap-composer-card-header">
          <div className="apoaap-composer-mode-pills" role="tablist" aria-label="Composer mode">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "reply"}
              className={`apoaap-composer-mode-pill ${activeTab === "reply" ? "is-active" : ""}`}
              onClick={() => handleTabChange("reply")}
            >
              Reply
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "note"}
              className={`apoaap-composer-mode-pill ${activeTab === "note" ? "is-active is-note" : ""}`}
              onClick={() => handleTabChange("note")}
            >
              Internal note
            </button>
          </div>

          <div className="apoaap-composer-top-actions">
            {uploading ? (
              <div className="apoaap-composer-uploading">
                <Loader2 size={12} className="animate-spin" />
                <span>Uploading…</span>
              </div>
            ) : null}

            <button
              type="button"
              className="apoaap-composer-action-btn"
              title="Bold (Ctrl+B)"
              aria-label="Format bold"
              disabled={isPending || uploading}
              onClick={() => applyFormatting("**", "**", "bold text")}
            >
              <Bold size={13} />
            </button>
            <button
              type="button"
              className="apoaap-composer-action-btn"
              title="Italic (Ctrl+I)"
              aria-label="Format italic"
              disabled={isPending || uploading}
              onClick={() => applyFormatting("*", "*", "italic text")}
            >
              <Italic size={13} />
            </button>
            <button
              type="button"
              className="apoaap-composer-action-btn"
              title="Inline Code"
              aria-label="Format inline code"
              disabled={isPending || uploading}
              onClick={() => applyFormatting("`", "`", "code")}
            >
              <Code size={13} />
            </button>
            <button
              type="button"
              className="apoaap-composer-action-btn"
              title="Bullet List"
              aria-label="Insert bullet list"
              disabled={isPending || uploading}
              onClick={() => applyFormatting("- ", "", "item", true)}
            >
              <List size={13} />
            </button>
            <span className="apoaap-composer-sep" aria-hidden="true" />
            <button
              type="button"
              className="apoaap-composer-canned-btn"
              title="Insert Canned Reply (/)"
              aria-label="Open canned replies"
              disabled={isPending || uploading}
              onClick={() => {
                onDraftChange(draft ? `${draft} /` : "/");
                setSlashQuery("/");
                setSlashOpen(true);
                setTimeout(() => textareaRef.current?.focus(), 0);
              }}
            >
              / Canned
            </button>
          </div>
        </div>

        {/* Textarea Area */}
        <div className="apoaap-composer-card-body">
          <textarea
            ref={textareaRef}
            id="inbox-composer-body"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={3}
            className="apoaap-composer-textarea"
            aria-label={activeTab === "reply" ? "Reply body" : "Internal note body"}
          />
        </div>

        {/* Attachment Preview Chip */}
        {attachment ? (
          <div className="apoaap-composer-attachment-chip">
            {attachment.isImage ? (
              <img
                src={attachment.url}
                alt={attachment.filename}
                style={{ width: "20px", height: "20px", objectFit: "cover", borderRadius: "3px" }}
              />
            ) : (
              <FileText size={15} style={{ color: "var(--cp-accent)" }} />
            )}
            <span className="apoaap-composer-attachment-name">{attachment.filename}</span>
            <span className="apoaap-composer-attachment-size">({(attachment.size / 1024).toFixed(0)} KB)</span>
            <button
              type="button"
              className="apoaap-composer-attachment-remove"
              title="Remove attachment"
              aria-label="Remove attachment"
              onClick={() => setAttachment(null)}
            >
              <X size={13} />
            </button>
          </div>
        ) : null}

        {errorMessage ? (
          <Text className="apoaap-inbox-composer-error" role="alert">
            {errorMessage}
          </Text>
        ) : null}

        {/* Bottom bar: Attachment & Hint on Left, Send Button on Right */}
        <div className="apoaap-composer-card-footer">
          <div className="apoaap-composer-footer-left">
            <button
              type="button"
              className="apoaap-composer-attach-icon-btn"
              title="Attach File or Screenshot"
              aria-label="Attach file"
              disabled={isPending || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={14} />
            </button>
            <span className="apoaap-composer-footer-hint">
              {activeTab === "reply" && !connected
                ? "Connecting…"
                : "Ctrl+Enter sends · Ctrl+Shift+Enter sends & closes"}
            </span>
          </div>

          {/* Split Send Button */}
          <div ref={menuRef} className="apoaap-composer-split-send">
            <button
              type="submit"
              disabled={(!draft.trim() && !attachment) || isPending || uploading}
              className="apoaap-composer-send-btn"
              aria-label={submitLabel}
            >
              <Send size={13} />
              <span>{submitLabel}</span>
            </button>

            <button
              type="button"
              disabled={isPending || uploading}
              aria-haspopup="menu"
              aria-expanded={sendMenuOpen}
              aria-label="Send options"
              onClick={() => setSendMenuOpen((prev) => !prev)}
              className="apoaap-composer-send-arrow"
            >
              <ChevronDown size={14} />
            </button>

            {sendMenuOpen ? (
              <div className="apoaap-composer-send-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={`apoaap-composer-menu-item ${sendMode === "SEND" ? "is-selected" : ""}`}
                  onClick={() => {
                    setSendMode("SEND");
                    setSendMenuOpen(false);
                  }}
                >
                  <span>Send & keep open</span>
                  <span className="apoaap-composer-menu-shortcut">Ctrl+Enter</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className={`apoaap-composer-menu-item ${sendMode === "SEND_AND_CLOSE" ? "is-selected" : ""}`}
                  onClick={() => {
                    setSendMode("SEND_AND_CLOSE");
                    setSendMenuOpen(false);
                  }}
                >
                  <span>Send & Close</span>
                  <span className="apoaap-composer-menu-shortcut">Ctrl+Shift+Enter</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className={`apoaap-composer-menu-item ${sendMode === "SEND_AND_SNOOZE" ? "is-selected" : ""}`}
                  onClick={() => {
                    setSendMode("SEND_AND_SNOOZE");
                    setSendMenuOpen(false);
                  }}
                >
                  <span>Send & Snooze</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}

export function canCompose(role: Role): boolean {
  return role === "ADMIN" || role === "SUPPORT";
}
