import type { ConvStatus, SenderType } from ".prisma/control-plane";
import { getDb } from "../db.js";

/**
 * Support inbox persistence (cp-support-inbox). Every message — merchant, agent, or
 * system — persists to Conversation/Message. Presence determines the offline
 * "we'll email you" fallback; reply authorization (ADMIN/SUPPORT only) is enforced
 * in the realtime gateway + router, not here.
 */
export interface PersistedMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderType: SenderType;
  readonly senderId: string;
  readonly body: string;
  readonly attachmentUrl: string | null;
  readonly createdAt: string;
}

export class ConversationService {
  private readonly db = getDb();

  /** Find an open conversation for a shop or create one (merchant-initiated). */
  async getOrCreateForShop(appKey: string, shop: string): Promise<{ id: string }> {
    const existing = await this.db.conversation.findFirst({
      where: { appKey, shop, status: { not: "CLOSED" } },
      orderBy: { lastMessageAt: "desc" },
    });
    if (existing) return { id: existing.id };
    const created = await this.db.conversation.create({
      data: { appKey, shop, status: "OPEN" },
    });
    return { id: created.id };
  }

  /**
   * Persist a message and bump conversation activity. Agent/merchant messages
   * increment unread for the OTHER side; the unread bump for merchant messages
   * surfaces in the agent inbox.
   */
  async persistMessage(input: {
    conversationId: string;
    senderType: SenderType;
    senderId: string;
    body: string;
    attachmentUrl?: string | null;
  }): Promise<PersistedMessage> {
    const msg = await this.db.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: input.senderType,
        senderId: input.senderId,
        body: input.body,
        attachmentUrl: input.attachmentUrl ?? null,
      },
    });
    await this.db.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: msg.createdAt,
        // Inbound (merchant) messages add to the agent's unread count.
        unreadCount:
          input.senderType === "MERCHANT" ? { increment: 1 } : undefined,
      },
    });
    return toPersisted(msg);
  }

  /** Record the SYSTEM "we'll email you" fallback when no agent is online. */
  async recordEmailFallback(conversationId: string): Promise<PersistedMessage> {
    return this.persistMessage({
      conversationId,
      senderType: "SYSTEM",
      senderId: "system",
      body: "No agent is online right now — we'll email you a reply.",
    });
  }

  /** Ordered message history for a conversation (re-open / reconnect). */
  async history(conversationId: string): Promise<PersistedMessage[]> {
    const rows = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPersisted);
  }

  /** Agent inbox listing, filterable by status. */
  async listConversations(
    appKey: string,
    status?: ConvStatus,
  ): Promise<
    {
      id: string;
      shop: string;
      status: ConvStatus;
      assignedTo: string | null;
      unreadCount: number;
      lastMessageAt: string | null;
    }[]
  > {
    const rows = await this.db.conversation.findMany({
      where: { appKey, ...(status ? { status } : {}) },
      orderBy: { lastMessageAt: "desc" },
    });
    return rows.map((c) => ({
      id: c.id,
      shop: c.shop,
      status: c.status,
      assignedTo: c.assignedTo,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    }));
  }

  /** Manual assignment (cp-support-inbox AC7.4). */
  async assign(conversationId: string, agentUserId: string): Promise<void> {
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { assignedTo: agentUserId },
    });
  }

  /** Clear unread when an agent views a conversation. */
  async markRead(conversationId: string): Promise<void> {
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });
  }
}

function toPersisted(m: {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderId: string;
  body: string;
  attachmentUrl: string | null;
  createdAt: Date;
}): PersistedMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderType: m.senderType,
    senderId: m.senderId,
    body: m.body,
    attachmentUrl: m.attachmentUrl,
    createdAt: m.createdAt.toISOString(),
  };
}

let instance: ConversationService | null = null;
export function getConversationService(): ConversationService {
  if (!instance) instance = new ConversationService();
  return instance;
}
