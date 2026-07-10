import { z } from "zod";
import { router, requireAbility } from "../core.js";
import { getMerchantService } from "../../services/merchantService.js";

const MerchantQueryInput = z.object({
  search: z.string().optional(),
  sortField: z.enum(["installDate", "plan", "status"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(25),
});

/**
 * Merchant directory router (cp-merchant-directory). `view` ability gates both
 * procedures server-side; a role lacking it gets FORBIDDEN before any replica read.
 */
export const directoryRouter = router({
  list: requireAbility("view")
    .input(MerchantQueryInput)
    .query(({ ctx, input }) => getMerchantService().list(ctx.appKey, input)),

  detail: requireAbility("view")
    .input(z.object({ shop: z.string().min(1) }))
    .query(({ ctx, input }) => getMerchantService().detail(ctx.appKey, input.shop)),

  /** Merchant 360 (cp-merchant-360): detail + conversation history + audit trail. */
  overview: requireAbility("view")
    .input(z.object({ shop: z.string().min(1) }))
    .query(({ ctx, input }) => getMerchantService().overview(ctx.appKey, input.shop)),
});
