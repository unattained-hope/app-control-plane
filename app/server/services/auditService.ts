import type { AuditActorType, AuditSource, Prisma, PrismaClient } from "@prisma/client";
import { getDb } from "../db.js";

/**
 * Append-only audit (cp-audit-log). There is NO update/delete path here — only
 * `append` and `query`. The append accepts a transaction client so callers write
 * the audit row in the SAME transaction as their effect (cp-merchant-actions
 * AC4.4 / cp-audit-log atomicity): if the audit insert fails, the action rolls back.
 */
export interface AuditInput {
  readonly actorUserId: string;
  readonly appKey: string;
  readonly action: string;
  readonly merchantShop?: string | null;
  readonly target?: string | null;
  readonly before?: Prisma.InputJsonValue | null;
  readonly after?: Prisma.InputJsonValue | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  // Structured actor + source (cp-audit-taxonomy). Optional + defaulted so every
  // existing call site keeps compiling: UI staff actions default to INTERNAL/UI;
  // background-job writes pass SYSTEM/JOB.
  readonly actorEmail?: string | null;
  readonly actorType?: AuditActorType;
  readonly source?: AuditSource;
}

/** A Prisma client OR an interactive-transaction client. */
export type TxClient = PrismaClient | Prisma.TransactionClient;

export class AuditService {
  /** Append one immutable audit row. Pass a `tx` to make it atomic with an action. */
  async append(input: AuditInput, tx: TxClient = getDb()): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        appKey: input.appKey,
        action: input.action,
        merchantShop: input.merchantShop ?? null,
        target: input.target ?? null,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        actorEmail: input.actorEmail ?? null,
        actorType: input.actorType ?? "INTERNAL",
        source: input.source ?? "UI",
      },
    });
  }

  /** Filterable read (ADMIN-only enforcement happens in the router). */
  async query(filter: AuditQuery): Promise<AuditRow[]> {
    const db = getDb();
    const where: Prisma.AuditLogWhereInput = {};
    if (filter.actorUserId) where.actorUserId = filter.actorUserId;
    if (filter.appKey) where.appKey = filter.appKey;
    if (filter.merchantShop) where.merchantShop = filter.merchantShop;
    if (filter.action) where.action = filter.action;
    if (filter.actorType) where.actorType = filter.actorType;
    if (filter.source) where.source = filter.source;
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = filter.from;
      if (filter.to) where.createdAt.lte = filter.to;
    }
    const rows = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 200,
    });
    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      appKey: r.appKey,
      merchantShop: r.merchantShop,
      action: r.action,
      target: r.target,
      before: r.before,
      after: r.after,
      ip: r.ip,
      userAgent: r.userAgent,
      actorEmail: r.actorEmail,
      actorType: r.actorType,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

export interface AuditQuery {
  readonly actorUserId?: string;
  readonly appKey?: string;
  readonly merchantShop?: string;
  readonly action?: string;
  readonly actorType?: AuditActorType;
  readonly source?: AuditSource;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
}

export interface AuditRow {
  readonly id: string;
  readonly actorUserId: string;
  readonly appKey: string;
  readonly merchantShop: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly actorEmail: string | null;
  readonly actorType: AuditActorType;
  readonly source: AuditSource;
  readonly createdAt: string;
}

let instance: AuditService | null = null;
export function getAuditService(): AuditService {
  if (!instance) instance = new AuditService();
  return instance;
}
