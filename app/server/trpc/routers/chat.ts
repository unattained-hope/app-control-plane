import { z } from "zod";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { router, requireAbility } from "../core.js";
import { getConversationService } from "../../services/conversationService.js";
import { getSlaService } from "../../services/slaService.js";
import { getRoutingService } from "../../services/routingService.js";
import { getConversationTagService } from "../../services/conversationTagService.js";

/**
 * Agent inbox router (cp-support-inbox + Tier 1 enhancements). Listing/history/search
 * require `view`; reply-class operations (assign, priority, internal note, tags)
 * require `reply` (ADMIN/SUPPORT). Live reply happens over Socket.IO (chatGateway);
 * this router covers the non-realtime inbox operations.
 */

const PRIORITY = z.enum(["URGENT", "HIGH", "NORMAL", "LOW", "NONE"]);

function actorCtx(ctx: {
  identity: { id: string; email: string };
  ip: string | null;
  userAgent: string | null;
  appKey: string;
}) {
  return {
    actorUserId: ctx.identity.id,
    actorEmail: ctx.identity.email,
    appKey: ctx.appKey,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

function mapNotFound(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
  }
  throw err;
}

export const chatRouter = router({
  conversations: requireAbility("view")
    .input(z.object({ status: z.enum(["OPEN", "SNOOZED", "CLOSED"]).optional() }))
    .query(({ ctx, input }) =>
      getConversationService().listConversations(ctx.appKey, input.status),
    ),

  /** Server-side inbox search across shop / subject / tag / message body. */
  search: requireAbility("view")
    .input(
      z.object({
        query: z.string().optional(),
        status: z.enum(["OPEN", "SNOOZED", "CLOSED"]).optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(50).default(25),
      }),
    )
    .query(({ ctx, input }) => getConversationService().search(ctx.appKey, input)),

  /** Agent-facing history — includes internal notes. */
  history: requireAbility("view")
    .input(z.object({ conversationId: z.string() }))
    .query(({ input }) => getConversationService().history(input.conversationId)),

  assign: requireAbility("reply")
    .input(z.object({ conversationId: z.string(), agentUserId: z.string() }))
    .mutation(({ ctx, input }) =>
      getRoutingService()
        .assign(actorCtx(ctx), input.conversationId, input.agentUserId)
        .catch(mapNotFound),
    ),

  /** Set priority — (re)computes office-hours SLA due-times (cp-inbox-sla). */
  setPriority: requireAbility("reply")
    .input(z.object({ conversationId: z.string(), priority: PRIORITY }))
    .mutation(({ ctx, input }) =>
      getSlaService()
        .setPriority(actorCtx(ctx), input.conversationId, input.priority)
        .catch(mapNotFound),
    ),

  /** Post an agent-only internal note (never delivered to the merchant). */
  postInternalNote: requireAbility("reply")
    .input(z.object({ conversationId: z.string(), body: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getConversationService().postInternalNote(
        input.conversationId,
        ctx.identity.id,
        input.body,
      ),
    ),

  addTag: requireAbility("reply")
    .input(z.object({ conversationId: z.string(), label: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getConversationTagService()
        .addTag(actorCtx(ctx), input.conversationId, input.label)
        .catch(mapNotFound),
    ),

  removeTag: requireAbility("reply")
    .input(z.object({ conversationId: z.string(), label: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getConversationTagService()
        .removeTag(actorCtx(ctx), input.conversationId, input.label)
        .catch(mapNotFound),
    ),

  tags: requireAbility("view")
    .input(z.object({ conversationId: z.string() }))
    .query(({ input }) => getConversationTagService().list(input.conversationId)),

  markRead: requireAbility("reply")
    .input(z.object({ conversationId: z.string() }))
    .mutation(({ input }) => getConversationService().markRead(input.conversationId)),
});
