import { FileText, Image as ImageIcon } from "lucide-react";
import type { ChatMessage } from "./types.js";
import {
  SENDER_LABEL,
  formatRelativeTimestamp,
  formatSenderId,
  formatTimestamp,
} from "./format.js";
import { MarkdownText } from "./MarkdownText.js";

function isImageUrl(url: string): boolean {
  const clean = (url.split("?")[0] ?? "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg|avif)$/.test(clean);
}

function AttachmentPreview({ url }: { readonly url: string }) {
  const isImg = isImageUrl(url);
  const filename = url.split("/").pop()?.split("?")[0] || "attachment";

  if (isImg) {
    return (
      <div style={{ marginTop: "0.5rem" }}>
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
              maxHeight: "220px",
              maxWidth: "100%",
              objectFit: "cover",
              borderRadius: "6px",
              border: "1px solid var(--cp-border)",
            }}
          />
        </a>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="apoaap-inbox-attachment"
        aria-label={`Open attachment ${filename}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 8px",
          borderRadius: "4px",
          background: "var(--cp-surface-2)",
          border: "1px solid var(--cp-border)",
          fontSize: "0.75rem",
          color: "var(--cp-text)",
          textDecoration: "none",
        }}
      >
        <FileText size={14} />
        <span style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {filename}
        </span>
        <span style={{ color: "var(--cp-text-muted)" }}>↗</span>
      </a>
    </div>
  );
}

export function MessageBubble({
  message,
  shop,
}: {
  readonly message: ChatMessage;
  readonly shop: string;
}) {
  if (message.internal) {
    return (
      <li className="apoaap-inbox-note" aria-label="Internal note">
        <div className="apoaap-inbox-note-header">
          <span className="apoaap-inbox-note-label">
            Internal note
            <span className="apoaap-inbox-note-meta"> · {message.senderId}</span>
          </span>
          <time
            className="apoaap-inbox-bubble-time"
            dateTime={message.createdAt}
            title={formatTimestamp(message.createdAt)}
          >
            {formatRelativeTimestamp(message.createdAt)}
          </time>
        </div>
        <div className="apoaap-inbox-note-body">
          <MarkdownText content={message.body} />
          {message.attachmentUrl ? <AttachmentPreview url={message.attachmentUrl} /> : null}
        </div>
      </li>
    );
  }

  if (message.senderType === "SYSTEM") {
    return (
      <li className="apoaap-inbox-system-msg" aria-label="System message">
        <div className="apoaap-inbox-system-bubble">
          <div className="apoaap-inbox-system-body">
            <MarkdownText content={message.body} />
          </div>
          <time
            className="apoaap-inbox-system-time"
            dateTime={message.createdAt}
            title={formatTimestamp(message.createdAt)}
          >
            {formatRelativeTimestamp(message.createdAt)}
          </time>
        </div>
      </li>
    );
  }

  const senderId = formatSenderId(message.senderType, message.senderId, shop);
  const bubbleClass =
    message.senderType === "AGENT"
      ? "apoaap-inbox-bubble is-agent"
      : "apoaap-inbox-bubble is-merchant";

  return (
    <li className={bubbleClass} aria-label={`${SENDER_LABEL[message.senderType]} message`}>
      <div className="apoaap-inbox-bubble-header">
        <span className="apoaap-inbox-bubble-sender">
          {SENDER_LABEL[message.senderType]}
          <span className="apoaap-inbox-bubble-meta"> · {senderId}</span>
        </span>
        <time
          className="apoaap-inbox-bubble-time"
          dateTime={message.createdAt}
          title={formatTimestamp(message.createdAt)}
        >
          {formatRelativeTimestamp(message.createdAt)}
        </time>
      </div>
      <div className="apoaap-inbox-bubble-body">
        <MarkdownText content={message.body} />
        {message.attachmentUrl ? <AttachmentPreview url={message.attachmentUrl} /> : null}
      </div>
    </li>
  );
}
