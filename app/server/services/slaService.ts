import {
  Prisma,
  type AuditActorType,
  type AuditSource,
  type Priority,
  type SlaState,
} from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import { computeDueTimes, breachWarningMinutes } from "./slaPolicy.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * Conversation SLA service (cp-inbox-sla).
 *
 * Owns two transitions, both audited in the same `$transaction` as their effect:
 *  - `setPriority`: assigns priority and (re)computes office-hours due-times. Setting
 *    `NONE` clears the SLA ("no priority ⇒ no SLA").
 *  - `sweep`: the repeatable-job entry that flips open, prioritized conversations to
 *    `BREACHING` (within the warning window) or `BREACHED` (past due), attributed to
 *    the system (actorType SYSTEM, source JOB).
 */

const SYSTEM_ACTOR = "system:sla-sweep";
const MINUTE_MS = 60_000;

export interface SlaActorContext {
  readonly actorUserId: string;
  readonly actorEmail?: string | null;
  readonly appKey: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Defaults to INTERNAL/UI; routing-driven priority passes SYSTEM/JOB. */
  readonly actorType?: AuditActorType;
  readonly source?: AuditSource;
}

function notFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Conversation not found", {
    code: "P2025",
    clientVersion: Prisma.prismaVersion.client,
  });
}

export class SlaService {
  constructor(
    private readonly db = getDb(),
    private readonly audit = getAuditService(),
  ) {}

  /**
   * Set a conversation's priority and (re)compute its SLA due-times from `now`
   * (the moment of assignment — design D1). `NONE` clears the SLA. Audited in-tx.
   */
  async setPriority(
    ctx: SlaActorContext,
    conversationId: string,
    priority: Priority,
    now: Date = new Date(),
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.conversation.findUnique({ where: { id: conversationId } });
      if (!before || before.appKey !== ctx.appKey) throw notFound();

      // Snapshot prior values before update (the row may be the same reference).
      const previousPriority = before.priority;
      const previousSlaState = before.slaState;
      const shop = before.shop;
      const firstReplyAt = before.firstReplyAt;

      const due = computeDueTimes(priority, now);
      // Recompute the SLA state: an already-replied conversation that met its new
      // first-response window stays MET; otherwise reset to ON_TRACK. NONE clears it.
      let slaState: SlaState = "ON_TRACK";
      if (due && firstReplyAt && firstReplyAt <= due.firstResponseDueAt) {
        slaState = "MET";
      }

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          priority,
          firstResponseDueAt: due?.firstResponseDueAt ?? null,
          resolutionDueAt: due?.resolutionDueAt ?? null,
          slaState,
        },
      });
      await this.audit.append(
        {
          actorUserId: ctx.actorUserId,
          actorEmail: ctx.actorEmail ?? null,
          actorType: ctx.actorType,
          source: ctx.source,
          appKey: ctx.appKey,
          merchantShop: shop,
          action: AuditActions.ConversationPrioritySet,
          target: conversationId,
          before: { priority: previousPriority, slaState: previousSlaState },
          after: { priority, slaState },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /**
   * Sweep open, prioritized conversations and flip SLA state. The "next relevant
   * due-time" is the first-response due while unreplied, else the resolution due.
   * Each transition is audited (SYSTEM/JOB). Returns the transition counts.
   */
  async sweep(
    appKey: string,
    now: Date = new Date(),
  ): Promise<{ breaching: number; breached: number }> {
    const open = await this.db.conversation.findMany({
      where: {
        appKey,
        status: { not: "CLOSED" },
        priority: { not: "NONE" },
        slaState: { in: ["ON_TRACK", "BREACHING"] },
      },
      take: 1000,
    });

    const warnMs = breachWarningMinutes() * MINUTE_MS;
    let breaching = 0;
    let breached = 0;

    for (const c of open) {
      const replied = c.firstReplyAt != null;
      const due = replied ? c.resolutionDueAt : c.firstResponseDueAt;
      if (!due) continue;

      let next: SlaState | null = null;
      if (now.getTime() > due.getTime()) next = "BREACHED";
      else if (now.getTime() > due.getTime() - warnMs) next = "BREACHING";
      if (!next || next === c.slaState) continue;
      const previousState = c.slaState;

      await this.db.$transaction(async (tx) => {
        await tx.conversation.update({ where: { id: c.id }, data: { slaState: next } });
        await this.audit.append(
          {
            actorUserId: SYSTEM_ACTOR,
            actorType: "SYSTEM",
            source: "JOB",
            appKey,
            merchantShop: c.shop,
            action:
              next === "BREACHED"
                ? AuditActions.ConversationSlaBreached
                : AuditActions.ConversationSlaBreaching,
            target: c.id,
            before: { slaState: previousState },
            after: { slaState: next, dueAt: due.toISOString() },
          },
          tx,
        );
      });

      if (next === "BREACHED") breached += 1;
      else breaching += 1;
    }

    return { breaching, breached };
  }
}

let instance: SlaService | null = null;
export function getSlaService(): SlaService {
  if (!instance) instance = new SlaService();
  return instance;
}
