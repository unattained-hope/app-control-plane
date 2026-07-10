import { z } from "zod";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { router, requireAbility } from "../core.js";
import { getRoutingService } from "../../services/routingService.js";

/**
 * Assignment-rule management router (cp-conversation-routing). All procedures
 * require the ADMIN-only `roles:manage` ability (registry/policy management).
 */

const PRIORITY = z.enum(["URGENT", "HIGH", "NORMAL", "LOW", "NONE"]);
const MATCH_FIELD = z.enum(["KEYWORD", "PLAN", "PRIORITY", "SHOP"]);

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
    throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
  }
  throw err;
}

export const routingRouter = router({
  rules: requireAbility("roles:manage").query(({ ctx }) =>
    getRoutingService().listRules(ctx.appKey),
  ),

  createRule: requireAbility("roles:manage")
    .input(
      z.object({
        order: z.number().int(),
        matchField: MATCH_FIELD,
        matchValue: z.string().min(1),
        assignTo: z.string().optional(),
        setPriority: PRIORITY.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      getRoutingService().createRule(actorCtx(ctx), {
        order: input.order,
        matchField: input.matchField,
        matchValue: input.matchValue,
        assignTo: input.assignTo ?? null,
        setPriority: input.setPriority ?? null,
      }),
    ),

  setRuleActive: requireAbility("roles:manage")
    .input(z.object({ id: z.string(), active: z.boolean() }))
    .mutation(({ ctx, input }) =>
      getRoutingService()
        .setRuleActive(actorCtx(ctx), input.id, input.active)
        .catch(mapNotFound),
    ),
});
