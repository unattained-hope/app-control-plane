import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { Bold, Code, FileText, Italic, Loader2, Paperclip, Send, X } from "lucide-react";
import { MarkdownText } from "./inbox/MarkdownText.js";
import {
  markdownToHtml,
  domToMarkdown,
} from "./inbox/richTextConverter.js";

/**
 * Embedded chat widget (cp-support-inbox). Ships INSIDE SaleSwitch's embedded
 * admin and renders within the existing iframe — it NEVER opens a top-level window
 * (AC7.1). It authenticates to the realtime backend with a host-minted, shop-scoped
 * token (AC7.2). Attachments are streamed from real HTTP(S) URLs, never `blob:`
 * navigation (AC7.5, Firefox-safe).
 *
 * This component is intended to be bundled into the SaleSwitch app; it lives here
 * as the canonical reference implementation of the widget contract.
 */
export interface ChatWidgetProps {
  /** Realtime backend origin (control plane). */
  readonly backendUrl: string;
  /** Host-minted shop-scoped token (minted server-side in the SaleSwitch loader). */
  readonly token: string;
}

interface ChatMessage {
  readonly id: string;
  readonly senderType: "MERCHANT" | "AGENT" | "SYSTEM";
  readonly body: string;
  readonly attachmentUrl: string | null;
  readonly createdAt: string;
}

interface WidgetAttachment {
  readonly url: string;
  readonly filename: string;
  readonly size: number;
  readonly isImage: boolean;
}

function isImageUrl(url: string): boolean {
  const clean = (url.split("?")[0] ?? "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg|avif)$/.test(clean);
}

function WidgetAttachmentBubble({ url }: { readonly url: string }) {
  const isImg = isImageUrl(url);
  const filename = url.split("/").pop()?.split("?")[0] || "attachment";

  if (isImg) {
    return (
      <div style={{ marginTop: "0.35rem" }}>
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          style={{ display: "inline-block", maxWidth: "100%" }}
          title="Click to view full image"
        >
          <img
            src={url}
            alt={filename}
            style={{
              maxHeight: "160px",
              maxWidth: "100%",
              objectFit: "cover",
              borderRadius: "4px",
              border: "1px solid rgba(0,0,0,0.1)",
            }}
          />
        </a>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.35rem" }}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "3px 6px",
          borderRadius: "4px",
          background: "rgba(0,0,0,0.06)",
          fontSize: "0.75rem",
          color: "inherit",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        <FileText size={13} />
        <span style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {filename}
        </span>
        <span style={{ opacity: 0.7 }}>↗</span>
      </a>
    </div>
  );
}

export function ChatWidget({ backendUrl, token }: ChatWidgetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<WidgetAttachment | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastDraftRef = useRef<string>("");

  useEffect(() => {
    // Cross-origin handshake with the host-minted token.
    const socket = io(backendUrl, {
      auth: { token },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => socket.emit("merchant:open"));
    socket.on("conversation", (c: { id: string }) => setConversationId(c.id));
    socket.on("history", (h: ChatMessage[]) => {
      setMessages(h);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
    socket.on("message", (m: ChatMessage) => {
      setMessages((prev) => [...prev, m]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [backendUrl, token]);

  const syncEditorValue = useCallback(() => {
    if (!editorRef.current) return;
    const md = domToMarkdown(editorRef.current);
    const cleanMd = md.replace(/\n{3,}/g, "\n\n").trimEnd();
    lastDraftRef.current = cleanMd;
    setDraft(cleanMd);
  }, []);

  function executeFormat(command: string, value: string | undefined = undefined) {
    if (editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand(command, false, value);
    syncEditorValue();
  }

  function handleInlineCode() {
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
        codeEl.style.background = "rgba(0,0,0,0.08)";
        codeEl.style.padding = "0.1rem 0.3rem";
        codeEl.style.borderRadius = "3px";
        codeEl.style.fontFamily = "monospace";
        codeEl.textContent = selectedText;
        range.deleteContents();
        range.insertNode(codeEl);
        range.selectNodeContents(codeEl);
      }
    } else {
      const codeEl = document.createElement("code");
      codeEl.style.background = "rgba(0,0,0,0.08)";
      codeEl.style.padding = "0.1rem 0.3rem";
      codeEl.style.borderRadius = "3px";
      codeEl.style.fontFamily = "monospace";
      codeEl.textContent = "code";
      range.insertNode(codeEl);
      range.selectNodeContents(codeEl);
    }
    syncEditorValue();
  }

  async function handleFileUpload(file: File) {
    if (!file || !conversationId) return;
    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const uploadUrl = `/api/chat/upload?conversationId=${encodeURIComponent(conversationId)}&token=${encodeURIComponent(token)}`;
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "x-shop-token": token,
        },
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

  function send() {
    const body = draft.trim();
    if ((!body && !attachment) || !conversationId) return;

    socketRef.current?.emit("merchant:message", {
      conversationId,
      body,
      attachmentUrl: attachment?.url ?? null,
    });

    setDraft("");
    lastDraftRef.current = "";
    if (editorRef.current) {
      editorRef.current.innerHTML = "";
    }
    setAttachment(null);
    setUploadError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const isCtrlOrCmd = e.metaKey || e.ctrlKey;

    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      executeFormat("bold");
      return;
    }

    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "i") {
      e.preventDefault();
      executeFormat("italic");
      return;
    }

    if (isCtrlOrCmd && !e.shiftKey && (e.key.toLowerCase() === "e" || e.key === "`")) {
      e.preventDefault();
      handleInlineCode();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="apoaap-chat-widget" role="log" aria-label="Support chat">
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={handleFileInputChange}
        aria-hidden="true"
      />

      <ul className="apoaap-widget-messages">
        {messages.map((m) => {
          const isMerchant = m.senderType === "MERCHANT";
          const isSystem = m.senderType === "SYSTEM";
          const bubbleClass = isSystem
            ? "apoaap-widget-bubble is-system"
            : isMerchant
              ? "apoaap-widget-bubble is-merchant"
              : "apoaap-widget-bubble is-agent";

          return (
            <li key={m.id} className={bubbleClass}>
              <div>
                <MarkdownText content={m.body} />
              </div>
              {m.attachmentUrl ? <WidgetAttachmentBubble url={m.attachmentUrl} /> : null}
              {!isSystem ? (
                <time className="apoaap-widget-bubble-time" dateTime={m.createdAt}>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
              ) : null}
            </li>
          );
        })}
        <div ref={messagesEndRef} />
      </ul>

      {/* Attachment Chip before sending */}
      {attachment ? (
        <div className="apoaap-composer-attachment-chip" style={{ margin: "0.25rem 0", fontSize: "0.72rem" }}>
          {attachment.isImage ? (
            <img
              src={attachment.url}
              alt={attachment.filename}
              style={{ width: "20px", height: "20px", objectFit: "cover", borderRadius: "3px" }}
            />
          ) : (
            <FileText size={14} style={{ color: "var(--cp-accent, #c2410c)" }} />
          )}
          <span className="apoaap-composer-attachment-name" style={{ maxWidth: "10rem" }}>
            {attachment.filename}
          </span>
          <button
            type="button"
            className="apoaap-composer-attachment-remove"
            title="Remove attachment"
            aria-label="Remove attachment"
            onClick={() => setAttachment(null)}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      {uploadError ? (
        <div style={{ fontSize: "0.72rem", color: "#ef4444", margin: "0.2rem 0", display: "flex", justifyContent: "space-between" }}>
          <span>{uploadError}</span>
          <button type="button" onClick={() => setUploadError(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>×</button>
        </div>
      ) : null}

      {/* Rich Input Card with formatting toolbar */}
      <div className="apoaap-widget-compose-card">
        <div className="apoaap-widget-toolbar">
          <button
            type="button"
            className="apoaap-widget-toolbar-btn"
            title="Bold (Ctrl+B)"
            aria-label="Format bold"
            onClick={() => executeFormat("bold")}
          >
            <Bold size={11} />
          </button>
          <button
            type="button"
            className="apoaap-widget-toolbar-btn"
            title="Italic (Ctrl+I)"
            aria-label="Format italic"
            onClick={() => executeFormat("italic")}
          >
            <Italic size={11} />
          </button>
          <button
            type="button"
            className="apoaap-widget-toolbar-btn"
            title="Inline Code (Ctrl+E)"
            aria-label="Format inline code"
            onClick={handleInlineCode}
          >
            <Code size={11} />
          </button>
          <button
            type="button"
            className="apoaap-widget-toolbar-btn"
            title="Attach file / image"
            aria-label="Attach file"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />}
          </button>
        </div>

        <div className="apoaap-widget-input-row">
          <div
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Type a message"
            data-placeholder="Type a message... (Ctrl+B bold, Ctrl+I italic, Enter sends)"
            className="apoaap-widget-rich-editor"
            onInput={syncEditorValue}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            tabIndex={0}
          />
          <button
            type="button"
            className="apoaap-widget-send-btn"
            onClick={send}
            disabled={(!draft.trim() && !attachment) || uploading}
            aria-label="Send message"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
