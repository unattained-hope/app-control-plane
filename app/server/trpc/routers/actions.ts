import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireAbility, authedProcedure } from "../core.js";
import {
  getMerchantActionService,
  ConfirmationError,
  AppApiUnavailableError,
  type ActionContext,
} from "../../services/merchantActionService.js";
import { getConnector } from "../../connectors/registry.js";
import { defineAbilityFor } from "../../rbac.js";

function actionCtx(ctx: {
  identity: { id: string; email: string; name: string | null; role: "ADMIN" | "SUPPORT" | "VIEWER" };
  ip: string | null;
  userAgent: string | null;
  appKey: string;
}, confirmText: string): ActionContext {
  return {
    actor: ctx.identity,
    appKey: ctx.appKey,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    confirmText,
  };
}

function mapActionError(err: unknown): never {
  if (err instanceof ConfirmationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof AppApiUnavailableError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
  }
  throw err;
}

/**
 * Merchant actions router (cp-merchant-actions). Note/tag writes require the
 * `reply` ability (ADMIN/SUPPORT). App-backed actions require `view` then check
 * the action's danger class against the actor's ability (dangerous => ADMIN-only),
 * server-side, before dispatch.
 */
export const actionsRouter = router({
  addNote: requireAbility("reply")
    .input(z.object({ shop: z.string(), body: z.string().min(1), confirmText: z.string() }))
    .mutation(({ ctx, input }) =>
      getMerchantActionService()
        .addNote(actionCtx(ctx, input.confirmText), input.shop, input.body)
        .catch(mapActionError),
    ),

  editNote: requireAbility("reply")
    .input(z.object({ noteId: z.string(), body: z.string().min(1), confirmText: z.string() }))
    .mutation(({ ctx, input }) =>
      getMerchantActionService()
        .editNote(actionCtx(ctx, input.confirmText), input.noteId, input.body)
        .catch(mapActionError),
    ),

  addTag: requireAbility("reply")
    .input(z.object({ shop: z.string(), label: z.string().min(1), confirmText: z.string() }))
    .mutation(({ ctx, input }) =>
      getMerchantActionService()
        .addTag(actionCtx(ctx, input.confirmText), input.shop, input.label)
        .catch(mapActionError),
    ),

  removeTag: requireAbility("reply")
    .input(z.object({ shop: z.string(), label: z.string().min(1), confirmText: z.string() }))
    .mutation(({ ctx, input }) =>
      getMerchantActionService()
        .removeTag(actionCtx(ctx, input.confirmText), input.shop, input.label)
        .catch(mapActionError),
    ),

  /** Dispatch an app-backed action; danger class checked against the role here. */
  dispatchAppBacked: authedProcedure
    .input(z.object({ shop: z.string(), actionKey: z.string(), confirmText: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const connector = await getConnector(ctx.appKey);
      const action = connector.actions.find((a) => a.key === input.actionKey);
      if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown action" });
      const ability = defineAbilityFor(ctx.identity.role);
      const needed = action.dangerous ? "action:dangerous" : "action:nondangerous";
      if (!ability.can(needed, "all")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getMerchantActionService()
        .dispatchAppBacked(actionCtx(ctx, input.confirmText), input.shop, input.actionKey)
        .catch(mapActionError);
    }),
});
