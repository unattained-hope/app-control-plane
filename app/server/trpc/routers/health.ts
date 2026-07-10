import { z } from "zod";
import { router, requireAbility } from "../core.js";
import { getMerchantHealthService } from "../../services/merchantHealthService.js";

/**
 * Merchant health router (cp-merchant-health). `view`-gated (every authed staff user):
 * `forShop` returns the latest pre-aggregated snapshot for the 360 panel; `atRisk`
 * returns the portfolio at-risk list ranked CRITICAL → AT_RISK → HEALTHY. Reads
 * pre-aggregated `MerchantHealthSnapshot` rows only — never a live join.
 */
export const healthRouter = router({
  forShop: requireAbility("view")
    .input(z.object({ shop: z.string().min(1) }))
    .query(({ ctx, input }) =>
      getMerchantHealthService().latestForShop(ctx.appKey, input.shop),
    ),

  atRisk: requireAbility("view").query(({ ctx }) =>
    getMerchantHealthService().atRisk(ctx.appKey),
  ),
});
