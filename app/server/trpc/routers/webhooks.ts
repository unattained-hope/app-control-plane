import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireAbility } from "../core.js";
import { getWebhookService } from "../../services/webhookService.js";

/**
 * Webhook reliability router (cp-webhook-reliability). `list` (the failed-delivery
 * view) is `ops:view`-gated; `replay` is the MUTATING ops action and is ADMIN-only.
 * Replay re-enqueues a dead-lettered event and audits `webhook.replayed` in-tx.
 */
export const webhooksRouter = router({
  list: requireAbility("ops:view")
    .input(
      z.object({
        status: z.array(z.enum(["FAILED", "DEAD_LETTER"])).optional(),
        topic: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(100).default(25),
      }),
    )
    .query(({ ctx, input }) =>
      getWebhookService().listFailed({
        appKey: ctx.appKey,
        status: input.status,
        topic: input.topic,
        page: input.page,
        pageSize: input.pageSize,
      }),
    ),

  replay: requireAbility("ops:view")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.identity.role !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Replay is ADMIN-only." });
      }
      await getWebhookService().replay(
        { id: ctx.identity.id, email: ctx.identity.email, ip: ctx.ip, userAgent: ctx.userAgent },
        ctx.appKey,
        input.id,
      );
      return { ok: true as const };
    }),
});
