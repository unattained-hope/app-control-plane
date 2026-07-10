import { router, requireAbility } from "../core.js";
import { getPlanChangeService } from "../../services/planChangeService.js";

/**
 * Plan-change admin router (cp-self-serve-billing). `view`-gated read of merchant
 * plan-change requests + their status. The merchant SUBMITS via the shop-token
 * resource route (`/api/self-serve-billing`), not here.
 */
export const plansRouter = router({
  requests: requireAbility("view").query(({ ctx }) =>
    getPlanChangeService().list(ctx.appKey),
  ),
});
