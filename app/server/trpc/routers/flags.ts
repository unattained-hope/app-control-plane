import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireAbility } from "../core.js";
import {
  getFeatureFlagService,
  FlagNotFoundError,
  type FlagActor,
} from "../../services/featureFlagService.js";

/**
 * Feature-flag router (cp-feature-flags). All procedures are `flags:manage` (ADMIN).
 * The app's per-shop evaluation is NOT here — it is served by the narrow authenticated
 * `/api/flags` resource route (the app pulls; the control plane never writes the app DB).
 */

function actorOf(ctx: {
  identity: { id: string; email: string };
  ip: string | null;
  userAgent: string | null;
}): FlagActor {
  return { id: ctx.identity.id, email: ctx.identity.email, ip: ctx.ip, userAgent: ctx.userAgent };
}

function mapError(err: unknown): never {
  if (err instanceof FlagNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  throw err;
}

const pct = z.number().int().min(0).max(100).nullable();

export const flagsRouter = router({
  list: requireAbility("flags:manage").query(({ ctx }) =>
    getFeatureFlagService().list(ctx.appKey),
  ),

  create: requireAbility("flags:manage")
    .input(
      z.object({
        key: z.string().min(1),
        description: z.string().optional(),
        defaultEnabled: z.boolean().default(false),
        rolloutPercentage: pct.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      getFeatureFlagService()
        .create(actorOf(ctx), ctx.appKey, {
          key: input.key,
          description: input.description ?? null,
          defaultEnabled: input.defaultEnabled,
          rolloutPercentage: input.rolloutPercentage ?? null,
        })
        .catch(mapError),
    ),

  update: requireAbility("flags:manage")
    .input(
      z.object({
        key: z.string().min(1),
        description: z.string().nullable().optional(),
        defaultEnabled: z.boolean().optional(),
        rolloutPercentage: pct.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      getFeatureFlagService()
        .update(actorOf(ctx), ctx.appKey, input.key, {
          description: input.description,
          defaultEnabled: input.defaultEnabled,
          rolloutPercentage: input.rolloutPercentage,
        })
        .catch(mapError),
    ),

  remove: requireAbility("flags:manage")
    .input(z.object({ key: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getFeatureFlagService().remove(actorOf(ctx), ctx.appKey, input.key).catch(mapError),
    ),

  setOverride: requireAbility("flags:manage")
    .input(
      z.object({ flagKey: z.string().min(1), shop: z.string().min(1), enabled: z.boolean() }),
    )
    .mutation(({ ctx, input }) =>
      getFeatureFlagService()
        .setOverride(actorOf(ctx), ctx.appKey, input.flagKey, input.shop, input.enabled)
        .catch(mapError),
    ),

  clearOverride: requireAbility("flags:manage")
    .input(z.object({ flagKey: z.string().min(1), shop: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getFeatureFlagService()
        .clearOverride(actorOf(ctx), ctx.appKey, input.flagKey, input.shop)
        .catch(mapError),
    ),
});
