import { getDb } from "../db.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";
import { captureError } from "~/lib/observability.js";
import {
  sloDefinitions,
  burnTiers,
  burnRate,
  tierFires,
  type AlertSeverity,
  type SloId,
} from "~/lib/sloPolicy.js";

/**
 * SLO burn-rate evaluation (cp-slo-alerting). On each ops tick it reads the persisted
 * per-tick error-ratio samples (`KpiSnapshot` ops rows) over each tier's short + long
 * windows, computes burn rate, and — when a tier fires (BOTH windows confirm) — emits
 * an alert signal through the Sentry sink (`captureError`, tagged with the SLO id and
 * `page`/`ticket` severity) for the BOUGHT on-call vendor, and writes a
 * `slo.alert.fired` audit row (SYSTEM/JOB). It does NOT page or schedule on-call.
 */

const SYSTEM_ACTOR = "system:ops-rollup";

export interface SloAlert {
  readonly sloId: SloId;
  readonly severity: AlertSeverity;
  readonly tierId: string;
  readonly longBurn: number;
  readonly shortBurn: number;
}

function severityRank(s: AlertSeverity): number {
  return s === "page" ? 2 : 1;
}

export class SloService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
  ) {}

  /** Mean error-ratio sample over a trailing window, or null if no samples exist. */
  private async windowErrorRate(
    appKey: string,
    metric: string,
    now: Date,
    windowMinutes: number,
  ): Promise<number | null> {
    const since = new Date(now.getTime() - windowMinutes * 60_000);
    const rows = await this.db.kpiSnapshot.findMany({
      where: { appKey, metric, asOf: { gte: since } },
    });
    if (rows.length === 0) return null;
    const sum = rows.reduce((acc: number, r: { value: number }) => acc + r.value, 0);
    return sum / rows.length;
  }

  /**
   * Evaluate every SLO for an app. Emits + audits each fired alert. Returns the fired
   * alerts (the highest-severity firing tier per SLO).
   */
  async evaluate(appKey: string, now: Date = new Date()): Promise<SloAlert[]> {
    const out: SloAlert[] = [];
    for (const def of sloDefinitions()) {
      let best: SloAlert | null = null;
      for (const tier of burnTiers()) {
        const longRate = await this.windowErrorRate(
          appKey,
          def.sampleMetric,
          now,
          tier.longWindowMinutes,
        );
        const shortRate = await this.windowErrorRate(
          appKey,
          def.sampleMetric,
          now,
          tier.shortWindowMinutes,
        );
        // No samples in the window → this SLO isn't evaluable yet (e.g. an
        // externally-fed availability SLO before any sample lands). Skip quietly.
        if (longRate == null || shortRate == null) continue;
        const longBurn = burnRate(longRate, def.objective);
        const shortBurn = burnRate(shortRate, def.objective);
        if (!tierFires(tier, longBurn, shortBurn)) continue;
        const candidate: SloAlert = {
          sloId: def.id,
          severity: tier.severity,
          tierId: tier.id,
          longBurn,
          shortBurn,
        };
        // Keep the most severe firing tier (page outranks ticket).
        if (!best || severityRank(candidate.severity) > severityRank(best.severity)) {
          best = candidate;
        }
      }
      if (best) {
        await this.emit(appKey, best, now);
        out.push(best);
      }
    }
    return out;
  }

  /** Emit the alert signal (Sentry sink) + the append-only audit row, in one place. */
  private async emit(appKey: string, alert: SloAlert, now: Date): Promise<void> {
    captureError(
      new Error(
        `SLO ${alert.sloId} burning (${alert.severity}): tier=${alert.tierId} ` +
          `longBurn=${alert.longBurn.toFixed(2)} shortBurn=${alert.shortBurn.toFixed(2)} app=${appKey}`,
      ),
      {
        slo: alert.sloId,
        severity: alert.severity,
        tier: alert.tierId,
        longBurn: alert.longBurn,
        shortBurn: alert.shortBurn,
        appKey,
      },
    );
    await this.audit.append(
      {
        actorUserId: SYSTEM_ACTOR,
        actorType: "SYSTEM",
        source: "JOB",
        appKey,
        action: AuditActions.SloAlertFired,
        target: alert.sloId,
        before: null,
        after: {
          severity: alert.severity,
          tier: alert.tierId,
          longBurn: alert.longBurn,
          shortBurn: alert.shortBurn,
          at: now.toISOString(),
        },
      },
      this.db,
    );
  }
}

let instance: SloService | null = null;
export function getSloService(): SloService {
  if (!instance) instance = new SloService();
  return instance;
}
