import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireAbility } from "../core.js";
import {
  getBreakGlassService,
  BreakGlassRequiredError,
  BreakGlassReasonRequiredError,
  BreakGlassStateError,
  type GrantActor,
} from "../../services/breakGlassService.js";

/**
 * Break-glass router (cp-break-glass-rbac). Requesting a grant is open to any authed
 * user (impersonation requests are ADMIN-gated); the MUTATING approve/deny/revoke and
 * impersonation entry/exit are ADMIN-only. Every transition is audited in the service.
 */

const ScopeEnum = z.enum(["PII_REVEAL", "IMPERSONATION"]);

function actorOf(ctx: {
  identity: { id: string; email: string };
  ip: string | null;
  userAgent: string | null;
}): GrantActor {
  return { id: ctx.identity.id, email: ctx.identity.email, ip: ctx.ip, userAgent: ctx.userAgent };
}

function assertAdmin(role: string): void {
  if (role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "ADMIN only." });
  }
}

function mapError(err: unknown): never {
  if (err instanceof BreakGlassReasonRequiredError || err instanceof BreakGlassStateError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof BreakGlassRequiredError) {
    throw new TRPCError({ code: "FORBIDDEN", message: err.message });
  }
  throw err;
}

export const breakGlassRouter = router({
  /** Request a time-boxed grant. Impersonation requests are ADMIN-only. */
  request: authedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        targetShop: z.string().optional(),
        reason: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (input.scope === "IMPERSONATION") assertAdmin(ctx.identity.role);
      return getBreakGlassService()
        .request(actorOf(ctx), {
          appKey: ctx.appKey,
          scope: input.scope,
          targetShop: input.targetShop ?? null,
          reason: input.reason,
        })
        .catch(mapError);
    }),

  /** List grants (pending approvals + recent), `ops:view`-gated. */
  list: requireAbility("ops:view")
    .input(
      z
        .object({
          actorUserId: z.string().optional(),
          status: z
            .enum(["REQUESTED", "APPROVED", "ACTIVE", "EXPIRED", "REVOKED", "DENIED"])
            .optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      getBreakGlassService().list(ctx.appKey, {
        actorUserId: input?.actorUserId,
        status: input?.status,
      }),
    ),

  approve: requireAbility("ops:view")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      assertAdmin(ctx.identity.role);
      return getBreakGlassService().approve(actorOf(ctx), ctx.appKey, input.id).catch(mapError);
    }),

  deny: requireAbility("ops:view")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      assertAdmin(ctx.identity.role);
      return getBreakGlassService().deny(actorOf(ctx), ctx.appKey, input.id).catch(mapError);
    }),

  revoke: requireAbility("ops:view")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      assertAdmin(ctx.identity.role);
      return getBreakGlassService().revoke(actorOf(ctx), ctx.appKey, input.id).catch(mapError);
    }),

  /** Enter an impersonated context: ADMIN + an active IMPERSONATION grant. Audited. */
  startImpersonation: requireAbility("impersonate")
    .input(z.object({ targetUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const svc = getBreakGlassService();
      await svc.requireActiveGrant(ctx.appKey, ctx.identity.id, "IMPERSONATION").catch(mapError);
      await svc.auditImpersonationStart(actorOf(ctx), ctx.appKey, input.targetUserId);
      return { ok: true as const };
    }),

  endImpersonation: requireAbility("impersonate")
    .input(z.object({ targetUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await getBreakGlassService().auditImpersonationEnd(actorOf(ctx), ctx.appKey, input.targetUserId);
      return { ok: true as const };
    }),
});
