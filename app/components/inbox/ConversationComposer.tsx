import { useEffect, useRef, useState, useCallback } from "react";
import type { Role } from "@prisma/client";
import { Text } from "@tremor/react";
import {
  Bold,
  ChevronDown,
  Code,
  Eye,
  FileText,
  Italic,
  List,
  Loader2,
  Paperclip,
  PenTool,
  Send,
  X,
} from "lucide-react";
import { trpc } from "~/lib/trpc.js";
import { useAgentChatSocket } from "~/lib/agentChatSocket.js";
import type { ComposerTab } from "./types.js";
import { SlashCommandPicker } from "./SlashCommandPicker.js";
import { MarkdownText } from "./MarkdownText.js";
import {
  markdownToHtml,
  domToMarkdown,
} from "./richTextConverter.js";

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
  const [showPreview, setShowPreview] = useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const lastDraftRef = useRef<string>(draft);

  const setStatus = trpc.chat.setStatus.useMutation();

  const postNote = trpc.chat.postInternalNote.useMutation({
    onSuccess: () => {
      onDraftChange("");
      lastDraftRef.current = "";
      if (editorRef.current) {
        editorRef.current.innerHTML = "";
      }
      setAttachment(null);
      onPosted();
    },
  });

  // Sync draft prop into editor contenteditable when changed externally
  useEffect(() => {
    if (draft !== lastDraftRef.current) {
      lastDraftRef.current = draft;
      if (editorRef.current) {
        const nextHtml = markdownToHtml(draft);
        if (editorRef.current.innerHTML !== nextHtml) {
          editorRef.current.innerHTML = nextHtml;
        }
      }
    }
  }, [draft]);

  useEffect(() => {
    clearReplyError();
    setAttachment(null);
    setUploadError(null);
    setSlashOpen(false);
    setSendMenuOpen(false);
    setShowPreview(false);
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

  const syncEditorValue = useCallback(() => {
    if (!editorRef.current) return;
    const md = domToMarkdown(editorRef.current);
    const cleanMd = md.replace(/\n{3,}/g, "\n\n").trimEnd();
    lastDraftRef.current = cleanMd;
    onDraftChange(cleanMd);

    // Detect slash command
    const selection = window.getSelection();
    if (selection && selection.anchorNode) {
      const text = editorRef.current.innerText || "";
      const lastSlashIdx = text.lastIndexOf("/");
      if (lastSlashIdx !== -1) {
        const query = text.substring(lastSlashIdx);
        if (!/\s/.test(query)) {
          setSlashQuery(query);
          setSlashOpen(true);
        } else {
          setSlashOpen(false);
        }
      } else {
        setSlashOpen(false);
      }
    }

    if (activeTab === "reply") {
      if (cleanMd.trim()) {
        setTyping(conversationId, true);
        scheduleTypingStop();
      } else {
        stopTyping();
      }
    }
  }, [activeTab, conversationId, onDraftChange, setTyping]);

  function executeFormat(command: string, value: string | undefined = undefined) {
    if (showPreview) setShowPreview(false);
    if (editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand(command, false, value);
    syncEditorValue();
  }

  function handleInlineCode() {
    if (showPreview) setShowPreview(false);
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectedText = range.toString();

    if (selectedText) {
      const parentCode = (selection.anchorNode?.parentElement?.closest("code") ?? null) as HTMLElement | null;
      if (parentCode) {
        const textNode = document.createTextNode(parentCode.textContent || "");
        parentCode.parentNode?.replaceChild(textNode, parentCode);
      } else {
        const codeEl = document.createElement("code");
        codeEl.style.background = "var(--cp-surface-2, rgba(255,255,255,0.1))";
        codeEl.style.padding = "0.1rem 0.35rem";
        codeEl.style.borderRadius = "0.25rem";
        codeEl.style.fontFamily = "var(--cp-font-mono, monospace)";
        codeEl.style.fontSize = "0.85em";
        codeEl.textContent = selectedText;
        range.deleteContents();
        range.insertNode(codeEl);
        range.selectNodeContents(codeEl);
      }
    } else {
      const codeEl = document.createElement("code");
      codeEl.style.background = "var(--cp-surface-2, rgba(255,255,255,0.1))";
      codeEl.style.padding = "0.1rem 0.35rem";
      codeEl.style.borderRadius = "0.25rem";
      codeEl.style.fontFamily = "var(--cp-font-mono, monospace)";
      codeEl.style.fontSize = "0.85em";
      codeEl.textContent = "code";
      range.insertNode(codeEl);
      range.selectNodeContents(codeEl);
    }
    syncEditorValue();
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
        throw new Error(data.error || `Upload failed with status ${res.status}`);
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

  function handlePaste(e: React.ClipboardEvent) {
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
    const currentVal = draft;
    const lastSlashIdx = currentVal.lastIndexOf("/");

    let nextVal = "";
    if (lastSlashIdx !== -1) {
      const prefix = currentVal.substring(0, lastSlashIdx);
      nextVal = prefix + body;
    } else {
      nextVal = currentVal ? `${currentVal}\n${body}` : body;
    }

    onDraftChange(nextVal);
    lastDraftRef.current = nextVal;
    if (editorRef.current) {
      editorRef.current.innerHTML = markdownToHtml(nextVal);
      editorRef.current.focus();
    }

    setSlashOpen(false);
  }

  async function submitDraft(mode: SendMode = sendMode) {
    const body = draft.trim();
    if ((!body && !attachment) || isPending) return;

    if (activeTab === "reply") {
      setSending(true);
      stopTyping();
      sendReply(conversationId, body, attachment?.url ?? null);
      onDraftChange("");
      lastDraftRef.current = "";
      if (editorRef.current) {
        editorRef.current.innerHTML = "";
      }
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (slashOpen && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape")) {
      return;
    }

    const isCtrlOrCmd = e.metaKey || e.ctrlKey;

    // Bold shortcut: Ctrl+B / Cmd+B
    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      executeFormat("bold");
      return;
    }

    // Italic shortcut: Ctrl+I / Cmd+I
    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "i") {
      e.preventDefault();
      executeFormat("italic");
      return;
    }

    // Inline Code shortcut: Ctrl+E / Ctrl+` / Cmd+E
    if (isCtrlOrCmd && !e.shiftKey && (e.key.toLowerCase() === "e" || e.key === "`")) {
      e.preventDefault();
      handleInlineCode();
      return;
    }

    // Strikethrough shortcut: Ctrl+Shift+X / Cmd+Shift+X / Ctrl+Shift+S
    if (isCtrlOrCmd && e.shiftKey && (e.key.toLowerCase() === "x" || e.key.toLowerCase() === "s")) {
      e.preventDefault();
      executeFormat("strikeThrough");
      return;
    }

    // Submit shortcuts: Ctrl+Enter or Ctrl+Shift+Enter
    if (isCtrlOrCmd && e.key === "Enter") {
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
      ? "Write a response... (Ctrl+B bold, Ctrl+I italic, '/' for templates, Ctrl+Enter to send)"
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
              onClick={() => executeFormat("bold")}
            >
              <Bold size={13} />
            </button>
            <button
              type="button"
              className="apoaap-composer-action-btn"
              title="Italic (Ctrl+I)"
              aria-label="Format italic"
              disabled={isPending || uploading}
              onClick={() => executeFormat("italic")}
            >
              <Italic size={13} />
            </button>
            <button
              type="button"
              className="apoaap-composer-action-btn"
              title="Inline Code (Ctrl+E)"
              aria-label="Format inline code"
              disabled={isPending || uploading}
              onClick={handleInlineCode}
            >
              <Code size={13} />
            </button>
            <button
              type="button"
              className="apoaap-composer-action-btn"
              title="Bullet List"
              aria-label="Insert bullet list"
              disabled={isPending || uploading}
              onClick={() => executeFormat("insertUnorderedList")}
            >
              <List size={13} />
            </button>

            <span className="apoaap-composer-sep" aria-hidden="true" />

            <button
              type="button"
              className={`apoaap-composer-action-btn ${showPreview ? "is-active" : ""}`}
              title={showPreview ? "Switch to Rich Editor" : "Preview Markdown"}
              aria-label={showPreview ? "Switch to rich editor" : "Preview markdown"}
              disabled={isPending || uploading}
              onClick={() => setShowPreview((prev) => !prev)}
            >
              {showPreview ? <PenTool size={13} /> : <Eye size={13} />}
            </button>

            <button
              type="button"
              className="apoaap-composer-canned-btn"
              title="Insert Canned Reply (/)"
              aria-label="Open canned replies"
              disabled={isPending || uploading}
              onClick={() => {
                if (showPreview) setShowPreview(false);
                const nextVal = draft ? `${draft} /` : "/";
                onDraftChange(nextVal);
                lastDraftRef.current = nextVal;
                if (editorRef.current) {
                  editorRef.current.innerHTML = markdownToHtml(nextVal);
                  editorRef.current.focus();
                }
                setSlashQuery("/");
                setSlashOpen(true);
              }}
            >
              / Canned
            </button>
          </div>
        </div>

        {/* Text Area (WYSIWYG Rich Editor / Live Markdown Preview) */}
        <div className="apoaap-composer-card-body">
          {showPreview ? (
            <div className="apoaap-composer-preview-pane">
              <MarkdownText content={draft || "*No content to preview*"} />
            </div>
          ) : (
            <div
              ref={editorRef}
              id="inbox-composer-body"
              contentEditable
              role="textbox"
              aria-multiline="true"
              aria-label={activeTab === "reply" ? "Reply body" : "Internal note body"}
              data-placeholder={placeholder}
              className="apoaap-composer-rich-editor"
              onInput={syncEditorValue}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              tabIndex={0}
            />
          )}
        </div>

        {/* Attachment Preview Chip */}
        {attachment ? (
          <div className="apoaap-composer-attachment-chip">
            {attachment.isImage ? (
              <img
                src={attachment.url}
                alt={attachment.filename}
                style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "3px" }}
              />
            ) : (
              <FileText size={16} style={{ color: "var(--cp-accent)" }} />
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
              <X size={14} />
            </button>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="apoaap-inbox-composer-error" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => {
                setUploadError(null);
                clearReplyError();
              }}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "0 4px" }}
              title="Dismiss error"
            >
              <X size={12} />
            </button>
          </div>
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
