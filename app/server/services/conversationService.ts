import type { ConvStatus, Prisma, Priority, SenderType, SlaState } from "@prisma/client";
import { getDb } from "../db.js";
import { getRoutingService } from "./routingService.js";

/** Upper bound on inbox-search page size (server-paginated; no full-list loads). */
const MAX_SEARCH_PAGE_SIZE = 50;

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
  /** Agent-only internal note (cp-canned-replies); never delivered to the merchant. */
  readonly internal: boolean;
  readonly attachmentUrl: string | null;
  readonly createdAt: string;
}

/** A conversation row for the agent inbox, including SLA/priority surfacing. */
export interface ConversationListRow {
  readonly id: string;
  readonly shop: string;
  readonly status: ConvStatus;
  readonly assignedTo: string | null;
  readonly priority: Priority;
  readonly slaState: SlaState;
  readonly firstReplyAt: string | null;
  readonly firstResponseDueAt: string | null;
  readonly resolutionDueAt: string | null;
  readonly csatScore: number | null;
  readonly unreadCount: number;
  readonly lastMessageAt: string | null;
}

export class ConversationService {
  // Constructor injection mirrors complianceService — a DB-free test seam.
  constructor(private readonly db = getDb()) {}

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
    // Rule-based routing on creation (cp-conversation-routing). Best-effort: a
    // routing failure must not block the merchant from opening a conversation.
    try {
      await getRoutingService().applyToNewConversation(appKey, created.id, { shop });
    } catch {
      // swallow — routing is an enhancement, not a prerequisite for chat
    }
    return { id: created.id };
  }

  /**
   * Persist a message and bump conversation activity. Agent/merchant messages
   * increment unread for the OTHER side; the unread bump for merchant messages
   * surfaces in the agent inbox.
   *
   * First-reply SLA (cp-inbox-sla): the FIRST non-internal AGENT reply stamps
   * `firstReplyAt` exactly once and marks the first-response SLA `MET` when it lands
   * before the due-time. An internal note never counts as a reply.
   */
  async persistMessage(input: {
    conversationId: string;
    senderType: SenderType;
    senderId: string;
    body: string;
    internal?: boolean;
    attachmentUrl?: string | null;
  }): Promise<PersistedMessage> {
    const internal = input.internal ?? false;
    const msg = await this.db.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: input.senderType,
        senderId: input.senderId,
        body: input.body,
        internal,
        attachmentUrl: input.attachmentUrl ?? null,
      },
    });

    const data: Record<string, unknown> = { lastMessageAt: msg.createdAt };
    // Inbound (merchant) messages add to the agent's unread count.
    if (input.senderType === "MERCHANT") data.unreadCount = { increment: 1 };

    // First-reply stamping: only a real (non-internal) agent reply qualifies.
    if (input.senderType === "AGENT" && !internal) {
      const convo = await this.db.conversation.findUnique({
        where: { id: input.conversationId },
      });
      if (convo && convo.firstReplyAt == null) {
        data.firstReplyAt = msg.createdAt;
        if (
          convo.firstResponseDueAt &&
          msg.createdAt <= convo.firstResponseDueAt &&
          (convo.slaState === "ON_TRACK" || convo.slaState === "BREACHING")
        ) {
          data.slaState = "MET";
        }
      }
    }

    await this.db.conversation.update({
      where: { id: input.conversationId },
      data,
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

  /** Persist an agent-only internal note (cp-canned-replies). */
  async postInternalNote(
    conversationId: string,
    agentUserId: string,
    body: string,
  ): Promise<PersistedMessage> {
    return this.persistMessage({
      conversationId,
      senderType: "AGENT",
      senderId: agentUserId,
      body,
      internal: true,
    });
  }

  /** Ordered message history for a conversation — AGENT view (includes internal). */
  async history(conversationId: string): Promise<PersistedMessage[]> {
    const rows = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPersisted);
  }

  /**
   * Merchant-facing history (cp-canned-replies): the same timeline with internal
   * notes filtered out at the SERVER. The merchant widget is never trusted to hide
   * them — this is the choke point.
   */
  async merchantHistory(conversationId: string): Promise<PersistedMessage[]> {
    const rows = await this.db.message.findMany({
      where: { conversationId, internal: false },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPersisted);
  }

  /** Agent inbox listing, filterable by status. */
  async listConversations(
    appKey: string,
    status?: ConvStatus,
  ): Promise<ConversationListRow[]> {
    const rows = await this.db.conversation.findMany({
      where: { appKey, ...(status ? { status } : {}) },
      orderBy: { lastMessageAt: "desc" },
    });
    return rows.map(toListRow);
  }

  /** All conversations for a shop (newest first) — drives the Merchant 360 panel. */
  async listForShop(appKey: string, shop: string): Promise<ConversationListRow[]> {
    const rows = await this.db.conversation.findMany({
      where: { appKey, shop },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    return rows.map(toListRow);
  }

  /**
   * Server-side inbox search (cp-conversation-csat): matches a term against shop,
   * subject, conversation tag labels, and message body. Server-paginated + capped
   * (no client-side filtering of a full list). `truncated` signals more pages exist.
   */
  async search(
    appKey: string,
    opts: { query?: string; status?: ConvStatus; page?: number; pageSize?: number },
  ): Promise<{
    rows: ConversationListRow[];
    total: number;
    page: number;
    pageSize: number;
    truncated: boolean;
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(Math.max(1, opts.pageSize ?? 25), MAX_SEARCH_PAGE_SIZE);
    const q = opts.query?.trim();
    const where: Prisma.ConversationWhereInput = {
      appKey,
      ...(opts.status ? { status: opts.status } : {}),
    };
    if (q) {
      where.OR = [
        { shop: { contains: q, mode: "insensitive" } },
        { subject: { contains: q, mode: "insensitive" } },
        { tags: { some: { label: { contains: q, mode: "insensitive" } } } },
        { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.db.conversation.count({ where }),
      this.db.conversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      rows: rows.map(toListRow),
      total,
      page,
      pageSize,
      truncated: total > page * pageSize,
    };
  }

  /** Clear unread when an agent views a conversation. */
  async markRead(conversationId: string): Promise<void> {
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });
  }

  /** Sum unread merchant messages across open conversations (nav badge). */
  async unreadTotal(appKey: string): Promise<number> {
    const rows = await this.db.conversation.findMany({
      where: { appKey, status: "OPEN" },
      select: { unreadCount: true },
    });
    return rows.reduce((sum, row) => sum + row.unreadCount, 0);
  }
}

function toListRow(c: {
  id: string;
  shop: string;
  status: ConvStatus;
  assignedTo: string | null;
  priority: Priority;
  slaState: SlaState;
  firstReplyAt: Date | null;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  csatScore: number | null;
  unreadCount: number;
  lastMessageAt: Date | null;
}): ConversationListRow {
  return {
    id: c.id,
    shop: c.shop,
    status: c.status,
    assignedTo: c.assignedTo,
    priority: c.priority,
    slaState: c.slaState,
    firstReplyAt: c.firstReplyAt ? c.firstReplyAt.toISOString() : null,
    firstResponseDueAt: c.firstResponseDueAt ? c.firstResponseDueAt.toISOString() : null,
    resolutionDueAt: c.resolutionDueAt ? c.resolutionDueAt.toISOString() : null,
    csatScore: c.csatScore,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
  };
}

function toPersisted(m: {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderId: string;
  body: string;
  internal: boolean;
  attachmentUrl: string | null;
  createdAt: Date;
}): PersistedMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderType: m.senderType,
    senderId: m.senderId,
    body: m.body,
    internal: m.internal,
    attachmentUrl: m.attachmentUrl,
    createdAt: m.createdAt.toISOString(),
  };
}

let instance: ConversationService | null = null;
export function getConversationService(): ConversationService {
  if (!instance) instance = new ConversationService();
  return instance;
}
