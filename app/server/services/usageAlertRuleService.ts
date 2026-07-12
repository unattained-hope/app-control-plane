// app/server/services/usageAlertRuleService.ts
// ADMIN management of the usage threshold-alert rule registry (cp usage-alerts-digest,
// usage-analytics Phase 5). Mirrors the FeatureFlagService / BadgeGraphicService admin-
// CRUD shape: a thin service over Prisma whose mutations are `usage_alerts:manage`
// (ADMIN, router-enforced) and AUDITED IN THE SAME TRANSACTION as their effect. Rules are
// DATA (metric/dimension/comparison/threshold) so ADMINs tune them without a redeploy;
// the alert-evaluation job (usageAlertService) reads only enabled rules. Read (`list`) is
// available so the UI can render the registry; only mutations require the ability.

import type { Prisma, UsageAlertRule } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService, type AuditService, type TxClient } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";

export class UsageAlertRuleNotFoundError extends Error {
  readonly code = "USAGE_ALERT_RULE_NOT_FOUND";
  constructor(id: string) {
    super(`Usage alert rule "${id}" not found.`);
  }
}

export class UsageAlertRuleKeyConflictError extends Error {
  readonly code = "USAGE_ALERT_RULE_KEY_CONFLICT";
  constructor(key: string) {
    super(`Usage alert rule key "${key}" already exists for this app.`);
  }
}

export interface UsageAlertRuleActor {
  readonly id: string;
  readonly email?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface CreateUsageAlertRuleInput {
  readonly key: string;
  readonly label: string;
  readonly metricKind: UsageAlertRule["metricKind"];
  readonly metric: string;
  readonly dimension?: string;
  readonly comparison: UsageAlertRule["comparison"];
  readonly threshold: number;
  readonly enabled?: boolean;
}

/** Editable fields (identity `key`/`metricKind` are fixed after create). */
export interface UpdateUsageAlertRuleInput {
  readonly label?: string;
  readonly metric?: string;
  readonly dimension?: string;
  readonly comparison?: UsageAlertRule["comparison"];
  readonly threshold?: number;
}

export class UsageAlertRuleService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
  ) {}

  /** All rules for an app (the admin list + the evaluation source when filtered to enabled). */
  async list(appKey: string): Promise<UsageAlertRule[]> {
    return this.db.usageAlertRule.findMany({
      where: { appKey },
      orderBy: { key: "asc" },
    });
  }

  /** Create a rule + audit `usage.alert.rule.create` (same tx). */
  async create(
    actor: UsageAlertRuleActor,
    appKey: string,
    input: CreateUsageAlertRuleInput,
  ): Promise<UsageAlertRule> {
    const existing = await this.db.usageAlertRule.findFirst({
      where: { appKey, key: input.key },
    });
    if (existing) throw new UsageAlertRuleKeyConflictError(input.key);

    return this.db.$transaction(async (tx) => {
      const rule = await tx.usageAlertRule.create({
        data: {
          appKey,
          key: input.key,
          label: input.label,
          metricKind: input.metricKind,
          metric: input.metric,
          dimension: input.dimension ?? "",
          comparison: input.comparison,
          threshold: input.threshold,
          enabled: input.enabled ?? false,
        },
      });
      await this.appendAudit(tx, actor, appKey, AuditActions.UsageAlertRuleCreate, rule.id, null, {
        key: rule.key,
        metric: rule.metric,
        threshold: rule.threshold,
        enabled: rule.enabled,
      });
      return rule;
    });
  }

  /** Update a rule's editable fields (threshold/label/etc.) + audit `usage.alert.rule.update`. */
  async update(
    actor: UsageAlertRuleActor,
    appKey: string,
    id: string,
    patch: UpdateUsageAlertRuleInput,
  ): Promise<UsageAlertRule> {
    return this.db.$transaction(async (tx) => {
      const before = await tx.usageAlertRule.findFirst({ where: { id, appKey } });
      if (!before) throw new UsageAlertRuleNotFoundError(id);
      const rule = await tx.usageAlertRule.update({
        where: { id },
        data: {
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.metric !== undefined ? { metric: patch.metric } : {}),
          ...(patch.dimension !== undefined ? { dimension: patch.dimension } : {}),
          ...(patch.comparison !== undefined ? { comparison: patch.comparison } : {}),
          ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
        },
      });
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.UsageAlertRuleUpdate,
        id,
        { label: before.label, metric: before.metric, threshold: before.threshold },
        { label: rule.label, metric: rule.metric, threshold: rule.threshold },
      );
      return rule;
    });
  }

  /**
   * Enable or disable a rule + audit the specific transition
   * (`usage.alert.rule.enable`/`disable`). A no-op transition (already in the target
   * state) still records an audit row for a complete admin trail.
   */
  async setEnabled(
    actor: UsageAlertRuleActor,
    appKey: string,
    id: string,
    enabled: boolean,
  ): Promise<UsageAlertRule> {
    return this.db.$transaction(async (tx) => {
      const before = await tx.usageAlertRule.findFirst({ where: { id, appKey } });
      if (!before) throw new UsageAlertRuleNotFoundError(id);
      const rule = await tx.usageAlertRule.update({ where: { id }, data: { enabled } });
      await this.appendAudit(
        tx,
        actor,
        appKey,
        enabled ? AuditActions.UsageAlertRuleEnable : AuditActions.UsageAlertRuleDisable,
        id,
        { enabled: before.enabled },
        { enabled: rule.enabled },
      );
      return rule;
    });
  }

  /** Delete a rule (its episode state cascades) + audit `usage.alert.rule.delete`. */
  async remove(actor: UsageAlertRuleActor, appKey: string, id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.usageAlertRule.findFirst({ where: { id, appKey } });
      if (!before) throw new UsageAlertRuleNotFoundError(id);
      await tx.usageAlertRule.delete({ where: { id } });
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.UsageAlertRuleDelete,
        id,
        { key: before.key, metric: before.metric, threshold: before.threshold },
        null,
      );
    });
  }

  private async appendAudit(
    tx: TxClient,
    actor: UsageAlertRuleActor,
    appKey: string,
    action: string,
    target: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue | null,
  ): Promise<void> {
    await this.audit.append(
      {
        actorUserId: actor.id,
        actorEmail: actor.email ?? null,
        appKey,
        merchantShop: null,
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

let instance: UsageAlertRuleService | null = null;
export function getUsageAlertRuleService(): UsageAlertRuleService {
  if (!instance) instance = new UsageAlertRuleService();
  return instance;
}
