// app/server/services/usageMirrorPruneService.ts
// Retention pruning for the usage-event mirror (usage-analytics Phase 2b). Deletes
// rows older than USAGE_MIRROR_RETENTION_MONTHS. Aggregates (Phase 3) are
// permanent, so pruning the raw mirror loses nothing the dashboards need. DB is
// DI'd so tests use FakeDb; the clock is injectable for deterministic window math.

import { getDb } from "../db.js";
import { getConfig } from "~/lib/config.js";
import { captureError } from "~/lib/observability.js";

interface PruneDb {
  usageEvent: {
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

export class UsageMirrorPruneService {
  constructor(
    private readonly db: PruneDb = getDb() as unknown as PruneDb,
    private readonly retentionMonths: number = getConfig().USAGE_MIRROR_RETENTION_MONTHS,
  ) {}

  /** Delete this app's mirror rows older than the retention window. Returns count. */
  async prune(appKey: string, now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - this.retentionMonths);
    const { count } = await this.db.usageEvent.deleteMany({
      where: { appKey, occurredAt: { lt: cutoff } },
    });
    return count;
  }
}

let instance: UsageMirrorPruneService | null = null;
export function getUsageMirrorPruneService(): UsageMirrorPruneService {
  if (instance === null) instance = new UsageMirrorPruneService();
  return instance;
}

/** Test seam. */
export function __setUsageMirrorPruneService(fake: UsageMirrorPruneService | null): void {
  instance = fake;
}

/** Worker entry: prune with error capture. */
export async function runUsageMirrorPrune(appKey: string): Promise<number> {
  try {
    return await getUsageMirrorPruneService().prune(appKey);
  } catch (err) {
    captureError(err, { job: "usage-prune", appKey });
    throw err;
  }
}
