import { z } from "zod";
import { router, requireAbility } from "../core.js";
import {
  getAnnouncementService,
  type AnnouncementActor,
} from "../../services/announcementService.js";
import { getNpsService } from "../../services/npsService.js";

/**
 * Announcements + NPS router (cp-announcements-nps). Publishing is
 * `announcements:manage` (ADMIN); the `nps` aggregate read is `view`. The merchant-side
 * NPS submission is NOT here — it arrives over the chat gateway (`merchant:nps`).
 */

function actorOf(ctx: {
  identity: { id: string; email: string };
  ip: string | null;
  userAgent: string | null;
}): AnnouncementActor {
  return { id: ctx.identity.id, email: ctx.identity.email, ip: ctx.ip, userAgent: ctx.userAgent };
}

export const announcementsRouter = router({
  publish: requireAbility("announcements:manage")
    .input(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        audience: z.enum(["ALL", "PLAN", "SHOP_LIST"]).default("ALL"),
        audienceValue: z.string().optional(),
        expiresAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      getAnnouncementService().publish(actorOf(ctx), ctx.appKey, {
        title: input.title,
        body: input.body,
        audience: input.audience,
        audienceValue: input.audienceValue ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      }),
    ),

  list: requireAbility("announcements:manage").query(({ ctx }) =>
    getAnnouncementService().list(ctx.appKey),
  ),

  nps: requireAbility("view").query(({ ctx }) => getNpsService().computeNps(ctx.appKey)),
});
