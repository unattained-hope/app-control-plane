import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireAbility } from "../core.js";
import {
  getBadgeGraphicService,
  BadgeGraphicNotFoundError,
  BadgeGraphicSlugConflictError,
  BadgeGraphicDefaultNotFoundError,
  type BadgeGraphicActor,
} from "../../services/badgeGraphicService.js";
import {
  badgeGraphicThemeSchema,
  badgeGraphicTypeSchema,
} from "~/lib/badgeGraphicTypes.js";

/**
 * Badge graphic gallery router (cp-app-settings). All procedures are
 * `settings:manage` (ADMIN). Scoped to `ctx.appKey`.
 */

function actorOf(ctx: {
  identity: { id: string; email: string };
  ip: string | null;
  userAgent: string | null;
}): BadgeGraphicActor {
  return { id: ctx.identity.id, email: ctx.identity.email, ip: ctx.ip, userAgent: ctx.userAgent };
}

function mapError(err: unknown): never {
  if (err instanceof BadgeGraphicNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err instanceof BadgeGraphicSlugConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message });
  }
  if (err instanceof BadgeGraphicDefaultNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  throw err;
}

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case");

const filtersSchema = z.object({
  theme: badgeGraphicThemeSchema.optional(),
  graphicType: badgeGraphicTypeSchema.optional(),
  search: z.string().optional(),
  includeArchived: z.boolean().optional(),
});

const createInputSchema = z.object({
  slug: slugSchema,
  label: z.string().min(1),
  imagePath: z.string().min(1),
  textBaked: z.boolean().default(true),
  theme: badgeGraphicThemeSchema,
  graphicType: badgeGraphicTypeSchema,
  sortOrder: z.number().int().optional(),
});

const updateInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  imagePath: z.string().min(1).optional(),
  textBaked: z.boolean().optional(),
  theme: badgeGraphicThemeSchema.optional(),
  graphicType: badgeGraphicTypeSchema.optional(),
  sortOrder: z.number().int().optional(),
});

export const badgeGraphicsRouter = router({
  list: requireAbility("settings:manage")
    .input(filtersSchema.optional())
    .query(({ ctx, input }) =>
      getBadgeGraphicService().list(ctx.appKey, input ?? {}),
    ),

  defaultSettings: requireAbility("settings:manage").query(async ({ ctx }) => {
    const svc = getBadgeGraphicService();
    const [defaultSlug, graphics, defaultGraphic] = await Promise.all([
      svc.getDefaultSlug(ctx.appKey),
      svc.list(ctx.appKey, { includeArchived: false }),
      svc.getDefaultGraphic(ctx.appKey),
    ]);
    return { defaultSlug, graphics, defaultGraphic };
  }),

  setDefault: requireAbility("settings:manage")
    .input(z.object({ slug: slugSchema }))
    .mutation(({ ctx, input }) =>
      getBadgeGraphicService()
        .setDefaultSlug(actorOf(ctx), ctx.appKey, input.slug)
        .catch(mapError),
    ),

  create: requireAbility("settings:manage")
    .input(createInputSchema)
    .mutation(({ ctx, input }) =>
      getBadgeGraphicService()
        .create(actorOf(ctx), ctx.appKey, input)
        .catch(mapError),
    ),

  update: requireAbility("settings:manage")
    .input(updateInputSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return getBadgeGraphicService()
        .update(actorOf(ctx), ctx.appKey, id, patch)
        .catch(mapError);
    }),

  archive: requireAbility("settings:manage")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getBadgeGraphicService()
        .archive(actorOf(ctx), ctx.appKey, input.id)
        .catch(mapError),
    ),

  remove: requireAbility("settings:manage")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      getBadgeGraphicService()
        .remove(actorOf(ctx), ctx.appKey, input.id)
        .catch(mapError),
    ),
});
