import { Prisma } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * Conversation tags (cp-conversation-csat). Control-plane-owned, unique per
 * conversation by label, mutable by anyone with `reply`. A search/triage dimension.
 * Adds/removes are audited.
 */

export interface TagActorContext {
  readonly actorUserId: string;
  readonly actorEmail?: string | null;
  readonly appKey: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export class ConversationTagService {
  constructor(
    private readonly db = getDb(),
    private readonly audit = getAuditService(),
  ) {}

  async list(conversationId: string): Promise<string[]> {
    const rows = await this.db.conversationTag.findMany({
      where: { conversationId },
      orderBy: { label: "asc" },
    });
    return rows.map((t) => t.label);
  }

  /** Add a tag. A duplicate label on the same conversation is a no-op. Audited. */
  async addTag(ctx: TagActorContext, conversationId: string, label: string): Promise<void> {
    const clean = label.trim();
    if (!clean) return;
    const convo = await this.db.conversation.findUnique({ where: { id: conversationId } });
    if (!convo || convo.appKey !== ctx.appKey) {
      throw new Prisma.PrismaClientKnownRequestError("Conversation not found", {
        code: "P2025",
        clientVersion: Prisma.prismaVersion.client,
      });
    }
    try {
      await this.db.$transaction(async (tx) => {
        await tx.conversationTag.create({
          data: { appKey: ctx.appKey, conversationId, label: clean },
        });
        await this.audit.append(
          {
            actorUserId: ctx.actorUserId,
            actorEmail: ctx.actorEmail ?? null,
            appKey: ctx.appKey,
            merchantShop: convo.shop,
            action: AuditActions.ConversationTagAdd,
            target: conversationId,
            before: null,
            after: { label: clean },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
      });
    } catch (err) {
      // Duplicate label → unique violation → no-op (the tag already exists).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return;
      }
      throw err;
    }
  }

  /** Remove a tag. Audited. */
  async removeTag(ctx: TagActorContext, conversationId: string, label: string): Promise<void> {
    const clean = label.trim();
    const convo = await this.db.conversation.findUnique({ where: { id: conversationId } });
    if (!convo || convo.appKey !== ctx.appKey) {
      throw new Prisma.PrismaClientKnownRequestError("Conversation not found", {
        code: "P2025",
        clientVersion: Prisma.prismaVersion.client,
      });
    }
    await this.db.$transaction(async (tx) => {
      await tx.conversationTag.deleteMany({ where: { conversationId, label: clean } });
      await this.audit.append(
        {
          actorUserId: ctx.actorUserId,
          actorEmail: ctx.actorEmail ?? null,
          appKey: ctx.appKey,
          merchantShop: convo.shop,
          action: AuditActions.ConversationTagRemove,
          target: conversationId,
          before: { label: clean },
          after: null,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }
}

let instance: ConversationTagService | null = null;
export function getConversationTagService(): ConversationTagService {
  if (!instance) instance = new ConversationTagService();
  return instance;
}
