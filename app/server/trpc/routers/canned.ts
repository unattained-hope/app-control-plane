import { z } from "zod";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { router, requireAbility } from "../core.js";
import {
  getCannedReplyService,
  renderCannedBody,
  DuplicateShortcutError,
} from "../../services/cannedReplyService.js";

/**
 * Canned replies router (cp-canned-replies). Listing/applying require `reply`
 * (ADMIN/SUPPORT); create/update/delete require the ADMIN-only `canned:manage`.
 */

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

function mapErr(err: unknown): never {
  if (err instanceof DuplicateShortcutError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Canned reply not found" });
  }
  throw err;
}

export const cannedRouter = router({
  list: requireAbility("reply").query(({ ctx }) =>
    getCannedReplyService().list(ctx.appKey),
  ),

  /** Resolve a canned reply's body with server-side variable substitution. */
  render: requireAbility("reply")
    .input(z.object({ id: z.string(), shop: z.string().optional(), merchantName: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const replies = await getCannedReplyService().list(ctx.appKey);
      const reply = replies.find((r) => r.id === input.id);
      if (!reply) throw new TRPCError({ code: "NOT_FOUND", message: "Canned reply not found" });
      const agentName = ctx.identity.name ?? ctx.identity.email;
      return {
        body: renderCannedBody(reply.body, {
          shop: input.shop ?? null,
          merchantName: input.merchantName ?? null,
          agentName,
        }),
      };
    }),

  create: requireAbility("canned:manage")
    .input(
      z.object({
        shortcut: z.string().min(1),
        title: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      getCannedReplyService().create(actorCtx(ctx), input).catch(mapErr),
    ),

  update: requireAbility("canned:manage")
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        body: z.string().min(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      getCannedReplyService()
        .update(actorCtx(ctx), input.id, { title: input.title, body: input.body })
        .catch(mapErr),
    ),

  remove: requireAbility("canned:manage")
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      getCannedReplyService().remove(actorCtx(ctx), input.id).catch(mapErr),
    ),
});
