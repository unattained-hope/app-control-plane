import type { FeatureFlag, Prisma } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";
import { isEnabled, type FlagDefinition } from "~/lib/featureFlagEval.js";

/**
 * Feature-flag registry + evaluation (cp-feature-flags). A SIMPLE boolean registry:
 * a per-app flag with a default + optional percentage ramp, plus per-shop overrides.
 * Mutations are `flags:manage` (ADMIN, router-enforced) and audited in the same
 * transaction. `evaluateForShop` is the app's read path (exposed via a narrow
 * authenticated endpoint); the control plane NEVER writes flags into the app DB. Rich
 * targeting/experiments are out of scope (roadmap "buy").
 */

export class FlagNotFoundError extends Error {
  readonly code = "FLAG_NOT_FOUND";
  constructor(key: string) {
    super(`Feature flag "${key}" not found.`);
  }
}

export interface FlagActor {
  readonly id: string;
  readonly email?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface UpsertFlagInput {
  readonly key: string;
  readonly description?: string | null;
  readonly defaultEnabled: boolean;
  readonly rolloutPercentage?: number | null;
}

export class FeatureFlagService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
  ) {}

  /** All flags for an app (the admin list + the evaluation source). */
  async list(appKey: string): Promise<FeatureFlag[]> {
    return this.db.featureFlag.findMany({ where: { appKey }, orderBy: { key: "asc" } });
  }

  /** Create a flag + audit `feature.flag.create` (same tx). */
  async create(actor: FlagActor, appKey: string, input: UpsertFlagInput): Promise<FeatureFlag> {
    return this.db.$transaction(async (tx) => {
      const flag = await tx.featureFlag.create({
        data: {
          appKey,
          key: input.key,
          description: input.description ?? null,
          defaultEnabled: input.defaultEnabled,
          rolloutPercentage: input.rolloutPercentage ?? null,
        },
      });
      await this.appendAudit(tx, actor, appKey, AuditActions.FeatureFlagCreate, flag.id, null, {
        key: flag.key,
        defaultEnabled: flag.defaultEnabled,
        rolloutPercentage: flag.rolloutPercentage,
      });
      return flag;
    });
  }

  /** Update a flag's default/percentage/description + audit `feature.flag.update`. */
  async update(
    actor: FlagActor,
    appKey: string,
    key: string,
    patch: Partial<Omit<UpsertFlagInput, "key">>,
  ): Promise<FeatureFlag> {
    return this.db.$transaction(async (tx) => {
      const before = await tx.featureFlag.findFirst({ where: { appKey, key } });
      if (!before) throw new FlagNotFoundError(key);
      const updated = await tx.featureFlag.update({
        where: { id: before.id },
        data: {
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.defaultEnabled !== undefined ? { defaultEnabled: patch.defaultEnabled } : {}),
          ...(patch.rolloutPercentage !== undefined
            ? { rolloutPercentage: patch.rolloutPercentage }
            : {}),
        },
      });
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.FeatureFlagUpdate,
        updated.id,
        { defaultEnabled: before.defaultEnabled, rolloutPercentage: before.rolloutPercentage },
        { defaultEnabled: updated.defaultEnabled, rolloutPercentage: updated.rolloutPercentage },
      );
      return updated;
    });
  }

  /** Delete a flag + its overrides + audit `feature.flag.delete`. */
  async remove(actor: FlagActor, appKey: string, key: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.featureFlag.findFirst({ where: { appKey, key } });
      if (!before) throw new FlagNotFoundError(key);
      await tx.featureFlag.delete({ where: { id: before.id } });
      await tx.featureFlagOverride.deleteMany({ where: { appKey, flagKey: key } });
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.FeatureFlagDelete,
        before.id,
        { key: before.key },
        null,
      );
    });
  }

  /** Set a per-shop override (on/off) + audit `feature.flag.override.set` (same tx). */
  async setOverride(
    actor: FlagActor,
    appKey: string,
    flagKey: string,
    shop: string,
    enabled: boolean,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.featureFlagOverride.findFirst({
        where: { appKey, flagKey, shop },
      });
      if (existing) {
        await tx.featureFlagOverride.update({ where: { id: existing.id }, data: { enabled } });
      } else {
        await tx.featureFlagOverride.create({ data: { appKey, flagKey, shop, enabled } });
      }
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.FeatureFlagOverrideSet,
        `${flagKey}:${shop}`,
        null,
        { flagKey, shop, enabled },
        shop,
      );
    });
  }

  /** Clear a per-shop override + audit `feature.flag.override.clear`. */
  async clearOverride(
    actor: FlagActor,
    appKey: string,
    flagKey: string,
    shop: string,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.featureFlagOverride.deleteMany({ where: { appKey, flagKey, shop } });
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.FeatureFlagOverrideClear,
        `${flagKey}:${shop}`,
        null,
        { flagKey, shop },
        shop,
      );
    });
  }

  /**
   * Evaluate every flag for a shop → `{ [key]: boolean }`. The app's read path. Applies
   * the per-shop override → percentage bucket → default precedence (pure
   * `featureFlagEval.isEnabled`). Reads CP tables only; writes nothing.
   */
  async evaluateForShop(appKey: string, shop: string): Promise<Record<string, boolean>> {
    const [flags, overrides] = await Promise.all([
      this.db.featureFlag.findMany({ where: { appKey } }),
      this.db.featureFlagOverride.findMany({ where: { appKey, shop } }),
    ]);
    const overrideByFlag = new Map(overrides.map((o) => [o.flagKey, o.enabled]));
    const out: Record<string, boolean> = {};
    for (const f of flags) {
      const def: FlagDefinition = {
        appKey: f.appKey,
        key: f.key,
        defaultEnabled: f.defaultEnabled,
        rolloutPercentage: f.rolloutPercentage,
      };
      out[f.key] = isEnabled(def, overrideByFlag.get(f.key) ?? null, shop);
    }
    return out;
  }

  private async appendAudit(
    tx: Parameters<AuditService["append"]>[1],
    actor: FlagActor,
    appKey: string,
    action: string,
    target: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue | null,
    merchantShop?: string,
  ): Promise<void> {
    await this.audit.append(
      {
        actorUserId: actor.id,
        actorEmail: actor.email ?? null,
        appKey,
        merchantShop: merchantShop ?? null,
        action,
        target,
        before,
        after,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      tx,
    );
  }
}

let instance: FeatureFlagService | null = null;
export function getFeatureFlagService(): FeatureFlagService {
  if (!instance) instance = new FeatureFlagService();
  return instance;
}
