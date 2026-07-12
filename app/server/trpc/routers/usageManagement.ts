import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireAbility } from "../core.js";
import {
  getUsageAlertRuleService,
  UsageAlertRuleNotFoundError,
  UsageAlertRuleKeyConflictError,
  type UsageAlertRuleActor,
} from "../../services/usageAlertRuleService.js";
import {
  getUsageSavedViewService,
  UsageSavedViewNotFoundError,
  UsageSavedViewNameConflictError,
  UsageSavedViewCapExceededError,
} from "../../services/usageSavedViewService.js";

/**
 * Usage MANAGEMENT router (usage-analytics Phase 5) — the WRITE surface the read-only
 * `usage` router deliberately excludes. Two concerns:
 *
 *  • `alertRules.*` — the ADMIN-only threshold-alert registry (`usage_alerts:manage`),
 *    audited in the service's transaction like every other admin write. It reads/writes
 *    CP-owned `UsageAlertRule`, never raw events.
 *
 *  • `savedViews.*` — per-admin explorer presets, OWNER-SCOPED and gated by `view`
 *    (every authenticated admin manages ONLY their own; the owner id comes from
 *    `ctx.identity`, never the input). Reads/writes CP-owned `UsageSavedView`; no event
 *    reads.
 */

function actorOf(ctx: {
  identity: { id: string; email: string };
  ip: string | null;
  userAgent: string | null;
}): UsageAlertRuleActor {
  return { id: ctx.identity.id, email: ctx.identity.email, ip: ctx.ip, userAgent: ctx.userAgent };
}

function mapAlertRuleError(err: unknown): never {
  if (err instanceof UsageAlertRuleNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err instanceof UsageAlertRuleKeyConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message });
  }
  throw err;
}

function mapSavedViewError(err: unknown): never {
  if (err instanceof UsageSavedViewNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err instanceof UsageSavedViewNameConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message });
  }
  if (err instanceof UsageSavedViewCapExceededError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
}

const ruleKeySchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, "Key must be a lowercase slug");

const metricKindSchema = z.enum([
  "METRIC_WOW_POINTS",
  "METRIC_WOW_PERCENT",
  "COHORT_TRANSITION",
]);
const comparisonSchema = z.enum(["DROP_GT", "RISE_GT"]);

const createRuleSchema = z.object({
  key: ruleKeySchema,
  label: z.string().min(1),
  metricKind: metricKindSchema,
  metric: z.string().min(1),
  dimension: z.string().optional(),
  comparison: comparisonSchema,
  threshold: z.number().finite(),
  enabled: z.boolean().optional(),
});

const updateRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  metric: z.string().min(1).optional(),
  dimension: z.string().optional(),
  comparison: comparisonSchema.optional(),
  threshold: z.number().finite().optional(),
});

// Opaque explorer state; capped in size so a preset can't be abused as blob storage.
const paramsSchema = z.record(z.string(), z.unknown()).refine(
  (v) => JSON.stringify(v).length <= 8_192,
  { message: "Saved-view params are too large." },
);

const alertRulesRouter = router({
  /** List every alert rule for the app (ADMIN — the registry management view). */
  list: requireAbility("usage_alerts:manage").query(({ ctx }) =>
    getUsageAlertRuleService().list(ctx.appKey),
  ),

  create: requireAbility("usage_alerts:manage")
    .input(createRuleSchema)
    .mutation(({ ctx, input }) =>
      getUsageAlertRuleService().create(actorOf(ctx), ctx.appKey, input).catch(mapAlertRuleError),
    ),

  update: requireAbility("usage_alerts:manage")
    .input(updateRuleSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return getUsageAlertRuleService()
        .update(actorOf(ctx), ctx.appKey, id, patch)
        .catch(mapAlertRuleError);
    }),

  setEnabled: requireAbility("usage_alerts:manage")
    .input(z.object({ id: z.string().min(1), enabled: z.boolean() }))
    .mutation(({ ctx, input }) =>
      getUsageAlertRuleService()
        .setEnabled(actorOf(ctx), ctx.appKey, input.id, input.enabled)
        .catch(mapAlertRuleError),
    ),

  remove: requireAbility("usage_alerts:manage")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getUsageAlertRuleService().remove(actorOf(ctx), ctx.appKey, input.id).catch(mapAlertRuleError),
    ),
});

const savedViewsRouter = router({
  /** The acting admin's OWN saved views (owner-scoped by ctx identity). */
  list: requireAbility("view").query(({ ctx }) =>
    getUsageSavedViewService().list(ctx.appKey, ctx.identity.id),
  ),

  create: requireAbility("view")
    .input(z.object({ name: z.string().min(1).max(80), params: paramsSchema }))
    .mutation(({ ctx, input }) =>
      getUsageSavedViewService()
        .create(ctx.appKey, ctx.identity.id, input)
        .catch(mapSavedViewError),
    ),

  update: requireAbility("view")
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        params: paramsSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return getUsageSavedViewService()
        .update(ctx.appKey, ctx.identity.id, id, patch)
        .catch(mapSavedViewError);
    }),

  remove: requireAbility("view")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getUsageSavedViewService()
        .remove(ctx.appKey, ctx.identity.id, input.id)
        .catch(mapSavedViewError),
    ),
});

export const usageManagementRouter = router({
  alertRules: alertRulesRouter,
  savedViews: savedViewsRouter,
});
