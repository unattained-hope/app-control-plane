import {
  Prisma,
  type BreakGlassGrant,
  type BreakGlassScope,
  type BreakGlassStatus,
} from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";
import { getConfig } from "~/lib/config.js";

/**
 * Break-glass / justified-access service (cp-break-glass-rbac). Issues time-boxed
 * grants that authorize an otherwise-eligible action (PII reveal, impersonation):
 *  - a typed `reason` is ALWAYS required;
 *  - non-sensitive scopes self-activate (`ACTIVE`); sensitive ones wait on ADMIN
 *    approval (config-driven);
 *  - `requireActiveGrant` is the enforcement choke point (403 without a live grant);
 *  - the ops sweep expires grants past `expiresAt`.
 * Every transition writes an append-only audit row in the SAME transaction.
 */

export class BreakGlassRequiredError extends Error {
  readonly code = "BREAK_GLASS_REQUIRED";
  constructor(scope: string) {
    super(`An active break-glass grant (${scope}) is required for this action.`);
  }
}

export class BreakGlassReasonRequiredError extends Error {
  readonly code = "REASON_REQUIRED";
  constructor() {
    super("A reason is required to request elevated access.");
  }
}

export class BreakGlassStateError extends Error {
  readonly code = "INVALID_STATE";
  constructor(message: string) {
    super(message);
  }
}

export interface GrantActor {
  readonly id: string;
  readonly email?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface RequestGrantInput {
  readonly appKey: string;
  readonly scope: BreakGlassScope;
  readonly targetShop?: string | null;
  readonly reason: string;
}

function notFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("BreakGlassGrant not found", {
    code: "P2025",
    clientVersion: Prisma.prismaVersion.client,
  });
}

/** Whether a scope is "sensitive" (requires ADMIN approval before activating). */
export function scopeRequiresApproval(scope: BreakGlassScope): boolean {
  const cfg = getConfig();
  return scope === "PII_REVEAL"
    ? cfg.BREAK_GLASS_PII_REQUIRES_APPROVAL
    : cfg.BREAK_GLASS_IMPERSONATION_REQUIRES_APPROVAL;
}

export class BreakGlassService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
  ) {}

  /** Request a grant. Self-activates for non-sensitive scopes; else `REQUESTED`. */
  async request(
    actor: GrantActor,
    input: RequestGrantInput,
    now: Date = new Date(),
  ): Promise<BreakGlassGrant> {
    if (!input.reason.trim()) throw new BreakGlassReasonRequiredError();
    const needsApproval = scopeRequiresApproval(input.scope);
    const status: BreakGlassStatus = needsApproval ? "REQUESTED" : "ACTIVE";
    const expiresAt = new Date(now.getTime() + getConfig().BREAK_GLASS_TTL_MINUTES * 60_000);
    return this.db.$transaction(async (tx) => {
      const grant = await tx.breakGlassGrant.create({
        data: {
          appKey: input.appKey,
          actorUserId: actor.id,
          scope: input.scope,
          targetShop: input.targetShop ?? null,
          reason: input.reason.trim(),
          status,
          expiresAt,
        },
      });
      await this.audit.append(
        {
          actorUserId: actor.id,
          actorEmail: actor.email ?? null,
          appKey: input.appKey,
          merchantShop: input.targetShop ?? null,
          action: needsApproval
            ? AuditActions.BreakGlassRequested
            : AuditActions.BreakGlassActivated,
          target: grant.id,
          before: null,
          after: {
            scope: input.scope,
            status,
            targetShop: input.targetShop ?? null,
            expiresAt: expiresAt.toISOString(),
          },
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
        tx,
      );
      return grant;
    });
  }

  /** Approve a pending (sensitive) grant → ACTIVE. ADMIN-only (router-enforced). */
  async approve(
    actor: GrantActor,
    appKey: string,
    grantId: string,
    now: Date = new Date(),
  ): Promise<BreakGlassGrant> {
    return this.transition(actor, appKey, grantId, {
      from: ["REQUESTED"],
      to: "ACTIVE",
      action: AuditActions.BreakGlassApproved,
      patch: { approverUserId: actor.id, expiresAt: new Date(now.getTime() + getConfig().BREAK_GLASS_TTL_MINUTES * 60_000) },
    });
  }

  /** Deny a pending grant → DENIED. */
  async deny(actor: GrantActor, appKey: string, grantId: string): Promise<BreakGlassGrant> {
    return this.transition(actor, appKey, grantId, {
      from: ["REQUESTED"],
      to: "DENIED",
      action: AuditActions.BreakGlassDenied,
      patch: { approverUserId: actor.id },
    });
  }

  /** Revoke an active/pending grant → REVOKED. */
  async revoke(actor: GrantActor, appKey: string, grantId: string): Promise<BreakGlassGrant> {
    return this.transition(actor, appKey, grantId, {
      from: ["REQUESTED", "APPROVED", "ACTIVE"],
      to: "REVOKED",
      action: AuditActions.BreakGlassRevoked,
      patch: {},
    });
  }

  private async transition(
    actor: GrantActor,
    appKey: string,
    grantId: string,
    spec: {
      from: BreakGlassStatus[];
      to: BreakGlassStatus;
      action: string;
      patch: Record<string, unknown>;
    },
  ): Promise<BreakGlassGrant> {
    return this.db.$transaction(async (tx) => {
      const grant = await tx.breakGlassGrant.findUnique({ where: { id: grantId } });
      if (!grant || grant.appKey !== appKey) throw notFound();
      if (!spec.from.includes(grant.status)) {
        throw new BreakGlassStateError(
          `Grant ${grantId} is ${grant.status}; cannot ${spec.to}.`,
        );
      }
      const updated = await tx.breakGlassGrant.update({
        where: { id: grantId },
        data: { status: spec.to, ...spec.patch },
      });
      await this.audit.append(
        {
          actorUserId: actor.id,
          actorEmail: actor.email ?? null,
          appKey,
          merchantShop: grant.targetShop,
          action: spec.action,
          target: grantId,
          before: { status: grant.status },
          after: { status: spec.to },
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * The enforcement choke point. Returns the covering grant or throws
   * `BreakGlassRequiredError`. A grant covers a shop when its `targetShop` matches OR
   * is null (app-wide for the scope).
   */
  async requireActiveGrant(
    appKey: string,
    actorUserId: string,
    scope: BreakGlassScope,
    targetShop?: string | null,
    now: Date = new Date(),
  ): Promise<BreakGlassGrant> {
    const grant = await this.db.breakGlassGrant.findFirst({
      where: {
        appKey,
        actorUserId,
        scope,
        status: "ACTIVE",
        expiresAt: { gt: now },
        ...(targetShop ? { OR: [{ targetShop }, { targetShop: null }] } : {}),
      },
      orderBy: { expiresAt: "desc" },
    });
    if (!grant) throw new BreakGlassRequiredError(scope);
    return grant;
  }

  /** Expire ACTIVE grants past their `expiresAt` (ops sweep). Audited SYSTEM/JOB. */
  async sweepExpired(appKey: string, now: Date = new Date()): Promise<number> {
    const expiring = await this.db.breakGlassGrant.findMany({
      where: { appKey, status: "ACTIVE", expiresAt: { lte: now } },
      take: 1000,
    });
    let count = 0;
    for (const g of expiring) {
      await this.db.$transaction(async (tx) => {
        await tx.breakGlassGrant.update({ where: { id: g.id }, data: { status: "EXPIRED" } });
        await this.audit.append(
          {
            actorUserId: "system:ops-rollup",
            actorType: "SYSTEM",
            source: "JOB",
            appKey,
            merchantShop: g.targetShop,
            action: AuditActions.BreakGlassExpired,
            target: g.id,
            before: { status: "ACTIVE" },
            after: { status: "EXPIRED" },
          },
          tx,
        );
      });
      count += 1;
    }
    return count;
  }

  /** Audit the start of an impersonated context (requires an active grant — checked by caller). */
  async auditImpersonationStart(
    actor: GrantActor,
    appKey: string,
    targetUserId: string,
  ): Promise<void> {
    await this.audit.append({
      actorUserId: actor.id,
      actorEmail: actor.email ?? null,
      appKey,
      action: AuditActions.ImpersonationStart,
      target: targetUserId,
      before: null,
      after: { targetUserId },
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });
  }

  /** Audit the end of an impersonated context. */
  async auditImpersonationEnd(
    actor: GrantActor,
    appKey: string,
    targetUserId: string,
  ): Promise<void> {
    await this.audit.append({
      actorUserId: actor.id,
      actorEmail: actor.email ?? null,
      appKey,
      action: AuditActions.ImpersonationEnd,
      target: targetUserId,
      before: null,
      after: { targetUserId },
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });
  }

  /** List grants for the UI (pending approvals + a user's own grants). */
  async list(
    appKey: string,
    filter: { actorUserId?: string; status?: BreakGlassStatus } = {},
  ): Promise<BreakGlassGrant[]> {
    return this.db.breakGlassGrant.findMany({
      where: {
        appKey,
        ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
}

let instance: BreakGlassService | null = null;
export function getBreakGlassService(): BreakGlassService {
  if (!instance) instance = new BreakGlassService();
  return instance;
}
