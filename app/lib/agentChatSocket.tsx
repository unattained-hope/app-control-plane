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
import { useNavigate } from "react-router";
import { io, type Socket } from "socket.io-client";
import type { Role } from "@prisma/client";
import { trpc } from "./trpc.js";
import {
  initAudioUnlock,
  isSoundEnabled,
  playNotificationSound,
  setSoundEnabled,
  startCallRinger,
  stopCallRinger,
  unlockAudio,
} from "./chatAudio.js";
import {
  getNotificationPermission,
  requestNotificationPermission,
  showBrowserNotification,
  closeBrowserNotification,
  type NotificationPermissionStatus,
} from "./browserNotifications.js";

interface PersistedMessageEvent {
  readonly id?: string;
  readonly conversationId: string;
  readonly senderType?: "MERCHANT" | "AGENT" | "SYSTEM";
  readonly senderId?: string;
  readonly body?: string;
  readonly internal?: boolean;
  readonly attachmentUrl?: string | null;
  readonly createdAt?: string;
}

export interface IncomingCall {
  readonly conversationId: string;
  readonly shop: string;
  readonly messageText: string;
  readonly startedAt: number;
  readonly expiresAt: number;
}

export interface AgentChatSocketValue {
  readonly connected: boolean;
  readonly replyError: string | null;
  readonly activeIncomingCall: IncomingCall | null;
  readonly notificationPermission: NotificationPermissionStatus;
  readonly soundEnabled: boolean;
  readonly toggleSound: () => void;
  readonly testNotificationSound: () => void;
  readonly testCallRinger: (durationSec?: number) => void;
  readonly clearReplyError: () => void;
  readonly joinConversation: (conversationId: string | null) => void;
  readonly sendReply: (conversationId: string, body: string, attachmentUrl?: string | null) => void;
  readonly setTyping: (conversationId: string, typing: boolean) => void;
  readonly answerIncomingCall: (conversationId: string) => void;
  readonly dismissIncomingCall: () => void;
  readonly requestNotifications: () => Promise<NotificationPermissionStatus>;
}

const AgentChatSocketContext = createContext<AgentChatSocketValue | null>(null);

/**
 * Shared agent Socket.IO connection for inbox activity, conversation join,
 * merchant-facing replies (`agent:reply`), typing indicators (`agent:typing`),
 * incoming call ringer (30s) + notification sounds, and desktop browser notifications.
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
  const navigate = useNavigate();
  const socketRef = useRef<Socket | null>(null);
  const joinedRef = useRef<string | null>(null);
  const agentNameRef = useRef(agentName);
  const [connected, setConnected] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [activeIncomingCall, setActiveIncomingCall] = useState<IncomingCall | null>(null);
  const activeIncomingCallRef = useRef<IncomingCall | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionStatus>("default");
  const [soundActive, setSoundActive] = useState(isSoundEnabled());

  useEffect(() => {
    agentNameRef.current = agentName;
  }, [agentName]);

  useEffect(() => {
    activeIncomingCallRef.current = activeIncomingCall;
  }, [activeIncomingCall]);

  useEffect(() => {
    initAudioUnlock();
    setNotificationPermission(getNotificationPermission());
    setSoundActive(isSoundEnabled());
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundActive;
    setSoundEnabled(next);
    setSoundActive(next);
    if (next) {
      void unlockAudio().then(() => playNotificationSound());
    }
  }, [soundActive]);

  const testNotificationSound = useCallback(() => {
    void unlockAudio().then(() => {
      playNotificationSound();
    });
  }, []);

  const testCallRinger = useCallback((durationSec = 5) => {
    const now = Date.now();
    const testCall: IncomingCall = {
      conversationId: "test-call-preview",
      shop: "test-merchant.myshopify.com",
      messageText: "Test incoming call ringer preview",
      startedAt: now,
      expiresAt: now + durationSec * 1000,
    };
    setActiveIncomingCall(testCall);
    void unlockAudio().then(() => {
      startCallRinger({
        durationSec,
        onStop: () => {
          setActiveIncomingCall((prev) =>
            prev?.conversationId === "test-call-preview" ? null : prev,
          );
        },
      });
    });
  }, []);

  const dismissIncomingCall = useCallback(() => {
    const current = activeIncomingCallRef.current;
    if (current) {
      closeBrowserNotification(`call-${current.conversationId}`);
    }
    stopCallRinger();
    setActiveIncomingCall(null);
  }, []);

  const joinConversation = useCallback(
    (conversationId: string | null) => {
      joinedRef.current = conversationId;
      if (conversationId && activeIncomingCallRef.current?.conversationId === conversationId) {
        dismissIncomingCall();
      }
      if (conversationId && socketRef.current?.connected) {
        socketRef.current.emit("agent:join", conversationId);
        void utils.chat.search.invalidate();
        void utils.chat.unreadTotal.invalidate();
        void utils.chat.conversations.invalidate();
      }
    },
    [dismissIncomingCall, utils],
  );

  const answerIncomingCall = useCallback(
    (conversationId: string) => {
      dismissIncomingCall();
      joinConversation(conversationId);
      void navigate(`/inbox?selected=${encodeURIComponent(conversationId)}`);
    },
    [dismissIncomingCall, joinConversation, navigate],
  );

  const requestNotifications = useCallback(async () => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
    return perm;
  }, []);

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
      void utils.chat.conversations.invalidate();

      // Play message chime on direct room message from merchant
      if (msg.senderType === "MERCHANT" && !msg.internal) {
        playNotificationSound();
      }
    });

    // Handle incoming chat and message events with sounds and browser notifications
    socket.on(
      "chat:incoming",
      (payload: {
        conversationId: string;
        shop: string;
        isNewChat: boolean;
        message?: PersistedMessageEvent;
        assignedTo?: string | null;
      }) => {
        void utils.chat.search.invalidate();
        void utils.chat.unreadTotal.invalidate();
        void utils.chat.conversations.invalidate();

        const messageBody = payload.message?.body ?? "";
        const isCurrentlyViewing = joinedRef.current === payload.conversationId;

        if (payload.isNewChat) {
          // If the user already has this conversation actively open, don't loop phone ring; play chime
          if (!isCurrentlyViewing) {
            const now = Date.now();
            const incoming: IncomingCall = {
              conversationId: payload.conversationId,
              shop: payload.shop,
              messageText: messageBody,
              startedAt: now,
              expiresAt: now + 30000,
            };
            setActiveIncomingCall(incoming);

            // Ring for up to 30 seconds or until stopped
            startCallRinger({
              durationSec: 30,
              onStop: () => {
                setActiveIncomingCall((prev) =>
                  prev?.conversationId === payload.conversationId ? null : prev,
                );
              },
            });

            // Browser popup notification for new incoming chat
            showBrowserNotification({
              title: `Incoming chat from ${payload.shop}`,
              body: messageBody || "A merchant is waiting for support.",
              tag: `call-${payload.conversationId}`,
              requireInteraction: true,
              autoCloseMs: 30000,
              onClick: () => {
                answerIncomingCall(payload.conversationId);
              },
            });
          } else {
            playNotificationSound();
          }
        } else {
          // Regular incoming message in an ongoing conversation
          if (payload.message?.senderType === "MERCHANT" || !payload.message?.senderType) {
            playNotificationSound();

            showBrowserNotification({
              title: `New message from ${payload.shop}`,
              body: messageBody || "New message received",
              tag: `msg-${payload.conversationId}-${payload.message?.id ?? Date.now()}`,
              autoCloseMs: 12000,
              onClick: () => {
                answerIncomingCall(payload.conversationId);
              },
            });
          }
        }
      },
    );

    // Stop ringer across all connected agents when chat is opened/received or assigned
    socket.on("chat:received", (payload: { conversationId: string; receivedBy?: string }) => {
      if (activeIncomingCallRef.current?.conversationId === payload.conversationId) {
        dismissIncomingCall();
      }
      void utils.chat.conversations.invalidate();
      void utils.chat.unreadTotal.invalidate();
    });

    socket.on("conversation:assigned", (payload: { conversationId: string; assignedTo?: string }) => {
      if (activeIncomingCallRef.current?.conversationId === payload.conversationId) {
        dismissIncomingCall();
      }
      void utils.chat.conversations.invalidate();
      void utils.chat.unreadTotal.invalidate();
    });

    socket.on("error:forbidden", (payload: { reason?: string }) => {
      setReplyError(payload.reason ?? "You do not have permission to reply");
    });

    return () => {
      stopCallRinger();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [userId, role, appKey, utils, answerIncomingCall, dismissIncomingCall]);

  const sendReply = useCallback(
    (conversationId: string, body: string, attachmentUrl?: string | null) => {
      if (!socketRef.current?.connected) {
        setReplyError("Not connected to chat server — try refreshing the page");
        return;
      }
      setReplyError(null);
      socketRef.current.emit("agent:reply", {
        conversationId,
        body,
        attachmentUrl: attachmentUrl ?? null,
      });
    },
    [],
  );

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
      activeIncomingCall,
      notificationPermission,
      soundEnabled: soundActive,
      toggleSound,
      testNotificationSound,
      testCallRinger,
      clearReplyError,
      joinConversation,
      sendReply,
      setTyping,
      answerIncomingCall,
      dismissIncomingCall,
      requestNotifications,
    }),
    [
      connected,
      replyError,
      activeIncomingCall,
      notificationPermission,
      soundActive,
      toggleSound,
      testNotificationSound,
      testCallRinger,
      clearReplyError,
      joinConversation,
      sendReply,
      setTyping,
      answerIncomingCall,
      dismissIncomingCall,
      requestNotifications,
    ],
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
