import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import type { Role } from "@prisma/client";
import { trpc } from "./trpc.js";

interface PersistedMessageEvent {
  readonly conversationId: string;
}

export interface AgentChatSocketValue {
  readonly connected: boolean;
  readonly replyError: string | null;
  readonly clearReplyError: () => void;
  readonly joinConversation: (conversationId: string | null) => void;
  readonly sendReply: (conversationId: string, body: string) => void;
  readonly setTyping: (conversationId: string, typing: boolean) => void;
}

const AgentChatSocketContext = createContext<AgentChatSocketValue | null>(null);

/**
 * Shared agent Socket.IO connection for inbox activity, conversation join,
 * merchant-facing replies (`agent:reply`), and typing indicators (`agent:typing`).
 */
export function AgentChatSocketProvider({
  userId,
  role,
  appKey,
  agentName,
  children,
}: {
  readonly userId: string | undefined;
  readonly role: Role;
  readonly appKey: string;
  readonly agentName: string;
  readonly children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const socketRef = useRef<Socket | null>(null);
  const joinedRef = useRef<string | null>(null);
  const agentNameRef = useRef(agentName);
  const [connected, setConnected] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  useEffect(() => {
    agentNameRef.current = agentName;
  }, [agentName]);

  useEffect(() => {
    if (!userId) return;

    const socket = io(window.location.origin, {
      auth: { agentUserId: userId, agentRole: role },
      // Prefer WebSocket; fall back to long-polling when proxies/basic-auth
      // interrupt the upgrade (same pattern as the merchant SupportChatBubble).
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("agent:inbox:subscribe", appKey);
      if (joinedRef.current) {
        socket.emit("agent:join", joinedRef.current);
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("inbox:activity", (payload: { conversationId: string }) => {
      void utils.chat.search.invalidate();
      void utils.chat.unreadTotal.invalidate();
      void utils.chat.conversations.invalidate();
      void utils.chat.history.invalidate({ conversationId: payload.conversationId });
    });

    socket.on("message", (msg: PersistedMessageEvent) => {
      void utils.chat.history.invalidate({ conversationId: msg.conversationId });
      void utils.chat.search.invalidate();
      void utils.chat.unreadTotal.invalidate();
    });

    socket.on("error:forbidden", (payload: { reason?: string }) => {
      setReplyError(payload.reason ?? "You do not have permission to reply");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [userId, role, appKey, utils]);

  const joinConversation = useCallback(
    (conversationId: string | null) => {
      joinedRef.current = conversationId;
      if (conversationId && socketRef.current?.connected) {
        socketRef.current.emit("agent:join", conversationId);
        void utils.chat.search.invalidate();
        void utils.chat.unreadTotal.invalidate();
      }
    },
    [utils],
  );

  const sendReply = useCallback((conversationId: string, body: string) => {
    if (!socketRef.current?.connected) {
      setReplyError("Not connected to chat server — try refreshing the page");
      return;
    }
    setReplyError(null);
    socketRef.current.emit("agent:reply", { conversationId, body });
  }, []);

  const setTyping = useCallback((conversationId: string, typing: boolean) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit("agent:typing", {
      conversationId,
      typing,
      agentName: agentNameRef.current,
    });
  }, []);

  const clearReplyError = useCallback(() => {
    setReplyError(null);
  }, []);

  const value = useMemo(
    (): AgentChatSocketValue => ({
      connected,
      replyError,
      clearReplyError,
      joinConversation,
      sendReply,
      setTyping,
    }),
    [connected, replyError, clearReplyError, joinConversation, sendReply, setTyping],
  );

  return (
    <AgentChatSocketContext.Provider value={value}>{children}</AgentChatSocketContext.Provider>
  );
}

export function useAgentChatSocket(): AgentChatSocketValue {
  const ctx = useContext(AgentChatSocketContext);
  if (!ctx) {
    throw new Error("useAgentChatSocket must be used within AgentChatSocketProvider");
  }
  return ctx;
}
