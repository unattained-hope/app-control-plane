import { router, requireAbility } from "../core.js";
import { getOpsMetricsService } from "../../services/opsMetricsService.js";

/**
 * Monitoring router (cp-ops-monitoring). `ops:view`-gated (ADMIN + SUPPORT). Returns
 * a LIVE snapshot of queue health (with derived worker-liveness), webhook/compliance
 * gauges, and a `generatedAt` marker. Reads BullMQ + control-plane tables only —
 * never the app DB.
 */
export const monitoringRouter = router({
  tiles: requireAbility("ops:view").query(({ ctx }) =>
    getOpsMetricsService().snapshot(ctx.appKey),
  ),
});
