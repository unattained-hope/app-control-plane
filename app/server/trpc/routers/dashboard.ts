import { router, requireAbility } from "../core.js";
import { getKpiService } from "../../services/kpiService.js";

/**
 * KPI dashboard router (cp-kpi-dashboard). Reads ONLY pre-aggregated KpiSnapshot
 * rows (no live joins). Gated by `view` server-side.
 */
export const dashboardRouter = router({
  kpis: requireAbility("view").query(({ ctx }) => getKpiService().latest(ctx.appKey)),
});
