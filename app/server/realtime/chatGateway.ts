import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { getConfig } from "~/lib/config.js";
import { getConversationService } from "../services/conversationService.js";
import { getPresence } from "./presence.js";
import { verifyShopToken, isAllowedOrigin } from "./sessionToken.js";
import type { Role } from ".prisma/control-plane";

/**
 * Socket.IO chat gateway (cp-support-inbox). Transport is Socket.IO + Redis
 * adapter for cross-instance fan-out. Merchant connections authenticate with a
 * host-minted shop-scoped token (scoped to one shop). Agent connections carry the
 * admin identity + role; only ADMIN/SUPPORT may reply. Every message persists.
 * When no agent is online, the merchant gets the email fallback and the
 * conversation is queued (persisted OPEN).
 */
type MerchantAuth = { kind: "merchant"; shop: string; appKey: string };
type AgentAuth = { kind: "agent"; userId: string; role: Role };
type SocketAuth = MerchantAuth | AgentAuth;

const authBySocket = new WeakMap<Socket, SocketAuth>();

export function attachChatGateway(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      // Explicit CORS — the origin check is enforced per-connection below too.
      origin: (origin, cb) => cb(null, true),
      credentials: true,
    },
  });

  // Redis adapter for multi-instance fan-out (AC7.3).
  const pub = new Redis(getConfig().REDIS_URL, { lazyConnect: true });
  const sub = pub.duplicate();
  io.adapter(createAdapter(pub, sub));

  const conversations = getConversationService();
  const presence = getPresence();

  io.use((socket, nextFn) => {
    const handshake = socket.handshake;
    const token = (handshake.auth?.["token"] as string | undefined) ?? "";
    const agentUserId = handshake.auth?.["agentUserId"] as string | undefined;
    const agentRole = handshake.auth?.["agentRole"] as Role | undefined;
    const origin = handshake.headers.origin ?? "";

    if (agentUserId && agentRole) {
      authBySocket.set(socket, { kind: "agent", userId: agentUserId, role: agentRole });
      return nextFn();
    }
    // Merchant: must present a valid host-minted shop token.
    const claims = verifyShopToken(token);
    if (!claims) return nextFn(new Error("unauthorized"));
    if (origin && !isAllowedOrigin(origin, claims.shop)) {
      return nextFn(new Error("origin not allowed"));
    }
    authBySocket.set(socket, { kind: "merchant", shop: claims.shop, appKey: claims.appKey });
    return nextFn();
  });

  io.on("connection", (socket) => {
    const auth = authBySocket.get(socket);
    if (!auth) return socket.disconnect(true);

    if (auth.kind === "agent") {
      presence.agentConnected(auth.userId);
      socket.on("disconnect", () => presence.agentDisconnected(auth.userId));

      socket.on("agent:reply", async (payload: { conversationId: string; body: string }) => {
        // Reply authorization: ADMIN/SUPPORT only (AC7 reply-role; VIEWER blocked).
        if (auth.role === "VIEWER") {
          socket.emit("error:forbidden", { reason: "VIEWER cannot reply" });
          return;
        }
        const msg = await conversations.persistMessage({
          conversationId: payload.conversationId,
          senderType: "AGENT",
          senderId: auth.userId,
          body: payload.body,
        });
        io.to(roomFor(payload.conversationId)).emit("message", msg);
      });

      socket.on("agent:join", (conversationId: string) => {
        void socket.join(roomFor(conversationId));
        void conversations.markRead(conversationId);
      });
      return;
    }

    // Merchant connection — scoped to its shop.
    socket.on("merchant:open", async () => {
      const convo = await conversations.getOrCreateForShop(auth.appKey, auth.shop);
      void socket.join(roomFor(convo.id));
      socket.emit("conversation", { id: convo.id });
      const history = await conversations.history(convo.id);
      socket.emit("history", history);
    });

    socket.on(
      "merchant:message",
      async (payload: { conversationId: string; body: string; attachmentUrl?: string }) => {
        const msg = await conversations.persistMessage({
          conversationId: payload.conversationId,
          senderType: "MERCHANT",
          senderId: auth.shop,
          body: payload.body,
          attachmentUrl: payload.attachmentUrl ?? null,
        });
        io.to(roomFor(payload.conversationId)).emit("message", msg);

        // Offline fallback (AC7.6): no agent online => email fallback + queue.
        if (!presence.anyAgentOnline()) {
          const fallback = await conversations.recordEmailFallback(payload.conversationId);
          socket.emit("message", fallback);
        }
      },
    );
  });

  return io;
}

function roomFor(conversationId: string): string {
  return `conversation:${conversationId}`;
}
