import { Text } from "@tremor/react";
import type { ChatMessage } from "./types.js";
import {
  SENDER_LABEL,
  formatRelativeTimestamp,
  formatSenderId,
  formatTimestamp,
} from "./format.js";

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
        <p className="apoaap-inbox-note-body">{message.body}</p>
      </li>
    );
  }

  const senderId = formatSenderId(message.senderType, message.senderId, shop);
  const bubbleClass =
    message.senderType === "AGENT"
      ? "apoaap-inbox-bubble is-agent"
      : message.senderType === "SYSTEM"
        ? "apoaap-inbox-bubble is-system"
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
      <Text className="apoaap-inbox-bubble-body">{message.body}</Text>
      {message.attachmentUrl ? (
        <a
          href={message.attachmentUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="apoaap-inbox-attachment"
          aria-label="Open attachment (new tab)"
        >
          Attachment ↗
        </a>
      ) : null}
    </li>
  );
}
