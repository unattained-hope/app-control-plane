import { z } from "zod";
import { router, requireAbility } from "../core.js";
import { getBillingService } from "../../services/billingService.js";

/**
 * Billing router (cp-billing-read). Read-only subscription state, gated by `view`.
 * The service handles caching + graceful fallback; this never throws to the view.
 */
export const billingRouter = router({
  subscription: requireAbility("view")
    .input(z.object({ shop: z.string().min(1) }))
    .query(({ input }) => getBillingService().getSubscription(input.shop)),
});
