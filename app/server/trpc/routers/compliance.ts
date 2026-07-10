import { z } from "zod";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { router, requireAbility } from "../core.js";
import { getComplianceService } from "../../services/complianceService.js";
import { ConfirmationError } from "../../services/merchantActionService.js";

/**
 * Compliance queue router (cp-compliance-dsr). Every procedure requires the
 * ADMIN-only `compliance:manage` ability — a non-ADMIN gets FORBIDDEN server-side
 * before any read or write. Webhook ingestion itself is unauthenticated (HMAC is
 * the auth); only this operator surface is role-gated.
 */
export const complianceRouter = router({
  pending: requireAbility("compliance:manage").query(({ ctx }) =>
    getComplianceService().listPending(ctx.appKey),
  ),

  breaching: requireAbility("compliance:manage")
    .input(z.object({ thresholdDays: z.number().int().positive().max(30).optional() }).optional())
    .query(({ ctx, input }) =>
      getComplianceService().listBreaching(ctx.appKey, input?.thresholdDays),
    ),

  markCompleted: requireAbility("compliance:manage")
    .input(z.object({ id: z.string().min(1), confirmText: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await getComplianceService().markCompleted(
          {
            actorUserId: ctx.identity.id,
            actorEmail: ctx.identity.email,
            appKey: ctx.appKey,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          input.id,
          input.confirmText,
        );
        return { ok: true };
      } catch (err) {
        if (err instanceof ConfirmationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Compliance request not found" });
        }
        throw err;
      }
    }),
});
