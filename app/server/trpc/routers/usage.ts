import { z } from "zod";
import { router, requireAbility } from "../core.js";
import { getUsageReadService } from "../../services/usageReadService.js";

/**
 * Usage-dashboards router (usage-analytics Phase 4). Every procedure is `view`-gated
 * (VIEWER and above) and READ-ONLY — there are no mutations in this router.
 *
 * ARCHITECTURE INVARIANT (AGENTS.md §6 "Dashboard from rollups"): the chart procedures
 * — `overview`, `features`, `funnel`, `shops` — read ONLY the pre-aggregated snapshot
 * tables (`UsageMetricDaily` / `KpiSnapshot` / `UsageCohortSnapshot`). None aggregates
 * raw events at request time.
 *
 * ── The `activity` exemption ──────────────────────────────────────────────────
 * `activity` is the SINGLE, DELIBERATE raw-event read the dashboards may issue
 * (design.md Decision 2). It is:
 *   • scoped to ONE shop,
 *   • cursor-paginated (newest first, page backwards via `before`),
 *   • HARD-capped per page at `USAGE_ACTIVITY_FEED_MAX_PAGE_SIZE` (enforced server-side),
 *   • read from the control plane's OWN mirror table (`UsageEvent`), never an app DB.
 * The invariant forbids app-DB reads and UNAGGREGATED DASHBOARD CHARTS; a bounded,
 * paginated feed from our own mirror is neither. The page shape (a cursor + capped
 * event list) is intentionally unsuited to charting, so it cannot be repurposed as a
 * chart source. Do NOT add any other raw-event read to this router.
 */

const activityInput = z.object({
  shop: z.string().min(1),
  // A page may ask for FEWER than the hard cap; the service clamps to the cap regardless.
  limit: z.number().int().positive().max(200).optional(),
  // Opaque cursor (the source seq of the last event on the previous page) to page older.
  before: z.string().nullable().optional(),
});

export const usageRouter = router({
  /** Overview page: stat tiles, active-shops trend, top actions, activation funnel. */
  overview: requireAbility("view").query(({ ctx }) =>
    getUsageReadService().overview(ctx.appKey),
  ),

  /** Feature-adoption page: 30/90-day adoption, per-feature trends, discount/campaign mixes. */
  features: requireAbility("view").query(({ ctx }) =>
    getUsageReadService().features(ctx.appKey),
  ),

  /** Wizard-funnel page: stage conversion + top validation rules (dwell deferred). */
  funnel: requireAbility("view").query(({ ctx }) =>
    getUsageReadService().funnel(ctx.appKey),
  ),

  /** Shop-explorer page: one aggregate row per shop from the latest cohort snapshot. */
  shops: requireAbility("view").query(({ ctx }) =>
    getUsageReadService().shops(ctx.appKey),
  ),

  /**
   * Merchant Activity feed — THE ONE raw-event read (see the router-level note above).
   * Bounded + cursor-paginated from the CP mirror; impersonated events are included and
   * flagged for support context.
   */
  activity: requireAbility("view")
    .input(activityInput)
    .query(({ ctx, input }) =>
      getUsageReadService().activityFeed(ctx.appKey, input.shop, {
        limit: input.limit,
        before: input.before ?? null,
      }),
    ),
});
