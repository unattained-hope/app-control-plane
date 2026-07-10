import { getDb } from "../db.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";
import { getConfig } from "~/lib/config.js";

/**
 * NPS capture + aggregation (cp-announcements-nps). Merchant-submitted through the
 * widget (the CSAT pattern). A score is validated 0–10; recording is IDEMPOTENT within
 * `NPS_SURVEY_WINDOW_DAYS` so a shop is counted once per window. Audited as a
 * merchant/system event. The growth rollup reads `computeNps` into a `KpiSnapshot`.
 */

export class InvalidNpsScoreError extends Error {
  readonly code = "INVALID_NPS_SCORE";
  constructor() {
    super("NPS score must be an integer between 0 and 10.");
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class NpsService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
  ) {}

  /**
   * Record an NPS response. Returns `{ recorded }` — false when the shop already has a
   * response within the survey window (idempotent no-op). Validates 0–10; audits on
   * record in the same transaction (a failed audit rolls the response back).
   */
  async record(
    appKey: string,
    shop: string,
    conversationId: string | null,
    score: number,
    comment: string | null = null,
    now: Date = new Date(),
  ): Promise<{ recorded: boolean }> {
    if (!Number.isInteger(score) || score < 0 || score > 10) {
      throw new InvalidNpsScoreError();
    }
    const windowStart = new Date(now.getTime() - getConfig().NPS_SURVEY_WINDOW_DAYS * DAY_MS);
    const existing = await this.db.npsResponse.findFirst({
      where: { appKey, shop, createdAt: { gte: windowStart } },
    });
    if (existing) return { recorded: false }; // idempotent within the window

    return this.db.$transaction(async (tx) => {
      const resp = await tx.npsResponse.create({
        data: { appKey, shop, conversationId, score, comment },
      });
      await this.audit.append(
        {
          actorUserId: `merchant:${shop}`,
          actorType: "SYSTEM",
          source: "API",
          appKey,
          merchantShop: shop,
          action: AuditActions.NpsRecorded,
          target: resp.id,
          before: null,
          after: { score },
        },
        tx,
      );
      return { recorded: true };
    });
  }

  /**
   * NPS = %promoters (9–10) − %detractors (0–6), as an integer −100..100. Computed over
   * all responses for the app; 0 when there are none. The growth rollup persists this
   * as a `KpiSnapshot` `nps` metric (the dashboard reads the pre-aggregated value).
   */
  async computeNps(appKey: string): Promise<number> {
    const rows = await this.db.npsResponse.findMany({ where: { appKey } });
    if (rows.length === 0) return 0;
    let promoters = 0;
    let detractors = 0;
    for (const r of rows) {
      const score = r.score as number;
      if (score >= 9) promoters += 1;
      else if (score <= 6) detractors += 1;
    }
    return Math.round(((promoters - detractors) / rows.length) * 100);
  }
}

let instance: NpsService | null = null;
export function getNpsService(): NpsService {
  if (!instance) instance = new NpsService();
  return instance;
}
