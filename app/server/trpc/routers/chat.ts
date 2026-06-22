import { z } from "zod";
import { router, requireAbility } from "../core.js";
import { getConversationService } from "../../services/conversationService.js";

/**
 * Agent inbox router (cp-support-inbox AC7.4). Listing/history require `view`;
 * assignment requires `reply` (ADMIN/SUPPORT). Live reply happens over Socket.IO
 * (chatGateway), where reply-role is also enforced; this router covers the
 * non-realtime inbox operations.
 */
export const chatRouter = router({
  conversations: requireAbility("view")
    .input(z.object({ status: z.enum(["OPEN", "SNOOZED", "CLOSED"]).optional() }))
    .query(({ ctx, input }) =>
      getConversationService().listConversations(ctx.appKey, input.status),
    ),

  history: requireAbility("view")
    .input(z.object({ conversationId: z.string() }))
    .query(({ input }) => getConversationService().history(input.conversationId)),

  assign: requireAbility("reply")
    .input(z.object({ conversationId: z.string(), agentUserId: z.string() }))
    .mutation(({ input }) =>
      getConversationService().assign(input.conversationId, input.agentUserId),
    ),

  markRead: requireAbility("reply")
    .input(z.object({ conversationId: z.string() }))
    .mutation(({ input }) => getConversationService().markRead(input.conversationId)),
});
