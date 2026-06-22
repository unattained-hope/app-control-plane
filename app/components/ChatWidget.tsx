import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

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

export function ChatWidget({ backendUrl, token }: ChatWidgetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Cross-origin handshake with the host-minted token.
    const socket = io(backendUrl, { auth: { token }, transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => socket.emit("merchant:open"));
    socket.on("conversation", (c: { id: string }) => setConversationId(c.id));
    socket.on("history", (h: ChatMessage[]) => setMessages(h));
    socket.on("message", (m: ChatMessage) => setMessages((prev) => [...prev, m]));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [backendUrl, token]);

  function send() {
    const body = draft.trim();
    if (!body || !conversationId) return;
    socketRef.current?.emit("merchant:message", { conversationId, body });
    setDraft("");
  }

  return (
    <div className="apoaap-chat-widget" role="log" aria-label="Support chat">
      <ul>
        {messages.map((m) => (
          <li key={m.id} data-sender={m.senderType}>
            <span>{m.body}</span>
            {/* Attachments open via a real HTTP(S) URL — never a blob: URL. */}
            {m.attachmentUrl ? (
              <a href={m.attachmentUrl} target="_self" rel="noreferrer">
                attachment
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="apoaap-chat-compose">
        <input
          aria-label="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button type="button" onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
