import { z } from "zod";
import { router, requireAbility } from "../core.js";
import { getAuditService } from "../../services/auditService.js";

/**
 * Audit log router (cp-audit-log). Read-only and ADMIN-only: the `audit:view`
 * ability is granted only to ADMIN, so SUPPORT/VIEWER get FORBIDDEN server-side.
 * There is NO update/delete procedure — append-only is enforced structurally.
 */
export const auditRouter = router({
  query: requireAbility("audit:view")
    .input(
      z.object({
        actorUserId: z.string().optional(),
        appKey: z.string().optional(),
        merchantShop: z.string().optional(),
        action: z.string().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      }),
    )
    .query(({ input }) => getAuditService().query(input)),
});
