import {
  Prisma,
  type AssignmentRule,
  type Priority,
  type RuleMatchField,
} from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import { getPresence } from "../realtime/presence.js";
import { getSlaService } from "./slaService.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * Conversation routing (cp-conversation-routing).
 *
 * Declarative `AssignmentRule`s are evaluated first-match-wins (by `order`) on new
 * conversations. Assignment is presence-aware: a rule that targets an offline agent
 * leaves the conversation queued (unassigned) rather than parking it. Every
 * assignment — rule-driven or manual — is audited in the same transaction.
 */

const SYSTEM_ACTOR = "system:routing";
const MAX_MATCH_LEN = 280;

export interface RoutingContext {
  readonly subject?: string | null;
  readonly firstMessageBody?: string | null;
  readonly plan?: string | null;
  readonly shop: string;
  readonly priority?: Priority;
}

export interface RoutingOutcome {
  /** Agent to assign (already presence-checked), or null to leave queued. */
  readonly assignTo: string | null;
  readonly setPriority: Priority | null;
  readonly matchedRuleId: string | null;
}

export interface AssignActorContext {
  readonly actorUserId: string;
  readonly actorEmail?: string | null;
  readonly appKey: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

function notFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Conversation not found", {
    code: "P2025",
    clientVersion: Prisma.prismaVersion.client,
  });
}

function matches(rule: AssignmentRule, ctx: RoutingContext): boolean {
  const needle = rule.matchValue.trim().toLowerCase();
  if (!needle) return false;
  switch (rule.matchField) {
    case "KEYWORD": {
      const hay = `${ctx.subject ?? ""} ${ctx.firstMessageBody ?? ""}`
        .slice(0, MAX_MATCH_LEN)
        .toLowerCase();
      return hay.includes(needle);
    }
    case "PLAN":
      return (ctx.plan ?? "").toLowerCase() === needle;
    case "SHOP":
      return ctx.shop.toLowerCase() === needle;
    case "PRIORITY":
      return (ctx.priority ?? "NONE").toLowerCase() === needle;
    default:
      return false;
  }
}

export class RoutingService {
  constructor(
    private readonly db = getDb(),
    private readonly audit = getAuditService(),
    private readonly presence = getPresence(),
  ) {}

  /**
   * Evaluate active rules first-match-wins and return the routing outcome. An
   * assignment to an offline agent is downgraded to "queued" (assignTo null).
   */
  async route(appKey: string, ctx: RoutingContext): Promise<RoutingOutcome> {
    const rules = await this.db.assignmentRule.findMany({
      where: { appKey, active: true },
      orderBy: { order: "asc" },
    });
    const matched = rules.find((r) => matches(r, ctx));
    if (!matched) {
      return { assignTo: null, setPriority: null, matchedRuleId: null };
    }
    let assignTo = matched.assignTo ?? null;
    // Presence-aware: never park a ticket on an offline agent.
    if (assignTo && !this.presence.isOnline(assignTo)) {
      assignTo = null;
    }
    return {
      assignTo,
      setPriority: matched.setPriority ?? null,
      matchedRuleId: matched.id,
    };
  }

  /**
   * Apply routing to a freshly-created conversation: set priority (via the SLA path
   * so due-times compute) and/or assign (audited). Attributed to the system.
   */
  async applyToNewConversation(
    appKey: string,
    conversationId: string,
    ctx: RoutingContext,
  ): Promise<RoutingOutcome> {
    // Idempotent: only an unrouted conversation (unassigned + no priority) is
    // routed, so this is safe to call again on the first merchant message.
    const current = await this.db.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!current || current.assignedTo || current.priority !== "NONE") {
      return { assignTo: null, setPriority: null, matchedRuleId: null };
    }
    const outcome = await this.route(appKey, ctx);
    if (outcome.setPriority && outcome.setPriority !== "NONE") {
      await getSlaService().setPriority(
        {
          actorUserId: SYSTEM_ACTOR,
          appKey,
          ip: null,
          userAgent: null,
          actorType: "SYSTEM",
          source: "JOB",
        },
        conversationId,
        outcome.setPriority,
      );
    }
    if (outcome.assignTo) {
      await this.assign(
        { actorUserId: SYSTEM_ACTOR, appKey, ip: null, userAgent: null },
        conversationId,
        outcome.assignTo,
        { system: true },
      );
    }
    return outcome;
  }

  /**
   * Assign (or reassign) a conversation, auditing the change in the same
   * transaction (cp-conversation-routing). `system: true` attributes it as a JOB.
   */
  async assign(
    ctx: AssignActorContext,
    conversationId: string,
    agentUserId: string,
    opts: { system?: boolean } = {},
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.conversation.findUnique({ where: { id: conversationId } });
      if (!before || before.appKey !== ctx.appKey) throw notFound();
      // Snapshot the prior value before update (the row may be the same reference).
      const previousAssignee = before.assignedTo;
      const shop = before.shop;
      await tx.conversation.update({
        where: { id: conversationId },
        data: { assignedTo: agentUserId },
      });
      await this.audit.append(
        {
          actorUserId: ctx.actorUserId,
          actorEmail: ctx.actorEmail ?? null,
          actorType: opts.system ? "SYSTEM" : "INTERNAL",
          source: opts.system ? "JOB" : "UI",
          appKey: ctx.appKey,
          merchantShop: shop,
          action: AuditActions.ConversationAssigned,
          target: conversationId,
          before: { assignedTo: previousAssignee },
          after: { assignedTo: agentUserId },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  // --- Rule management (ADMIN) -------------------------------------------------

  async listRules(appKey: string): Promise<RuleRow[]> {
    const rows = await this.db.assignmentRule.findMany({
      where: { appKey },
      orderBy: { order: "asc" },
    });
    return rows.map(toRuleRow);
  }

  /** Create a rule. Audited. */
  async createRule(
    ctx: AssignActorContext,
    input: {
      order: number;
      matchField: RuleMatchField;
      matchValue: string;
      assignTo?: string | null;
      setPriority?: Priority | null;
    },
  ): Promise<RuleRow> {
    return this.db.$transaction(async (tx) => {
      const created = await tx.assignmentRule.create({
        data: {
          appKey: ctx.appKey,
          order: input.order,
          matchField: input.matchField,
          matchValue: input.matchValue.trim(),
          assignTo: input.assignTo ?? null,
          setPriority: input.setPriority ?? null,
        },
      });
      await this.audit.append(
        {
          actorUserId: ctx.actorUserId,
          actorEmail: ctx.actorEmail ?? null,
          appKey: ctx.appKey,
          action: AuditActions.RoutingRuleCreate,
          target: created.id,
          before: null,
          after: { matchField: created.matchField, matchValue: created.matchValue },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return toRuleRow(created);
    });
  }

  /** Enable/disable a rule. Audited. */
  async setRuleActive(
    ctx: AssignActorContext,
    id: string,
    active: boolean,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.assignmentRule.findUnique({ where: { id } });
      if (!before || before.appKey !== ctx.appKey) throw notFound();
      await tx.assignmentRule.update({ where: { id }, data: { active } });
      await this.audit.append(
        {
          actorUserId: ctx.actorUserId,
          actorEmail: ctx.actorEmail ?? null,
          appKey: ctx.appKey,
          action: AuditActions.RoutingRuleUpdate,
          target: id,
          before: { active: before.active },
          after: { active },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }
}

export interface RuleRow {
  readonly id: string;
  readonly order: number;
  readonly matchField: RuleMatchField;
  readonly matchValue: string;
  readonly assignTo: string | null;
  readonly setPriority: Priority | null;
  readonly active: boolean;
}

function toRuleRow(r: AssignmentRule): RuleRow {
  return {
    id: r.id,
    order: r.order,
    matchField: r.matchField,
    matchValue: r.matchValue,
    assignTo: r.assignTo,
    setPriority: r.setPriority,
    active: r.active,
  };
}

let instance: RoutingService | null = null;
export function getRoutingService(): RoutingService {
  if (!instance) instance = new RoutingService();
  return instance;
}
