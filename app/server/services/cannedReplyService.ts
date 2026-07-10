import { Prisma } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * Canned replies / macros (cp-canned-replies). ADMIN-managed (`canned:manage`),
 * SUPPORT-usable (`reply`). Shortcuts are unique per app. Variable substitution is
 * resolved SERVER-SIDE at apply time so the stored template never trusts client
 * values. Management transitions are audited.
 */

export class DuplicateShortcutError extends Error {
  readonly code = "DUPLICATE_SHORTCUT";
  constructor(shortcut: string) {
    super(`A canned reply with shortcut "${shortcut}" already exists for this app.`);
  }
}

export interface CannedReplyRow {
  readonly id: string;
  readonly shortcut: string;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: string;
}

export interface CannedActorContext {
  readonly actorUserId: string;
  readonly actorEmail?: string | null;
  readonly appKey: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Context available for `{{...}}` substitution when a canned reply is applied. */
export interface CannedRenderContext {
  readonly shop?: string | null;
  readonly merchantName?: string | null;
  readonly agentName?: string | null;
}

/**
 * Substitute the supported variables, leaving any UNKNOWN placeholder verbatim.
 * Pure (no I/O) so it is trivially testable.
 */
export function renderCannedBody(body: string, ctx: CannedRenderContext): string {
  const values: Record<string, string> = {
    shop: ctx.shop ?? "",
    merchant_name: ctx.merchantName ?? "",
    agent_name: ctx.agentName ?? "",
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : whole;
  });
}

function toRow(r: {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  updatedAt: Date;
}): CannedReplyRow {
  return {
    id: r.id,
    shortcut: r.shortcut,
    title: r.title,
    body: r.body,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export class CannedReplyService {
  constructor(
    private readonly db = getDb(),
    private readonly audit = getAuditService(),
  ) {}

  /** List canned replies for an app (usable by anyone with `reply`). */
  async list(appKey: string): Promise<CannedReplyRow[]> {
    const rows = await this.db.cannedReply.findMany({
      where: { appKey },
      orderBy: { shortcut: "asc" },
    });
    return rows.map(toRow);
  }

  /** Create a canned reply (ADMIN). Unique shortcut per app; audited. */
  async create(
    ctx: CannedActorContext,
    input: { shortcut: string; title: string; body: string },
  ): Promise<CannedReplyRow> {
    try {
      return await this.db.$transaction(async (tx) => {
        const created = await tx.cannedReply.create({
          data: {
            appKey: ctx.appKey,
            shortcut: input.shortcut.trim(),
            title: input.title.trim(),
            body: input.body,
            createdBy: ctx.actorUserId,
          },
        });
        await this.audit.append(
          {
            actorUserId: ctx.actorUserId,
            actorEmail: ctx.actorEmail ?? null,
            appKey: ctx.appKey,
            action: AuditActions.CannedReplyCreate,
            target: created.id,
            before: null,
            after: { shortcut: created.shortcut, title: created.title },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
        return toRow(created);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new DuplicateShortcutError(input.shortcut.trim());
      }
      throw err;
    }
  }

  /** Update a canned reply (ADMIN). Audited. */
  async update(
    ctx: CannedActorContext,
    id: string,
    input: { title?: string; body?: string },
  ): Promise<CannedReplyRow> {
    return this.db.$transaction(async (tx) => {
      const before = await tx.cannedReply.findUnique({ where: { id } });
      if (!before || before.appKey !== ctx.appKey) {
        throw new Prisma.PrismaClientKnownRequestError("Canned reply not found", {
          code: "P2025",
          clientVersion: Prisma.prismaVersion.client,
        });
      }
      const previousTitle = before.title;
      const updated = await tx.cannedReply.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
        },
      });
      await this.audit.append(
        {
          actorUserId: ctx.actorUserId,
          actorEmail: ctx.actorEmail ?? null,
          appKey: ctx.appKey,
          action: AuditActions.CannedReplyUpdate,
          target: id,
          before: { title: previousTitle },
          after: { title: updated.title },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return toRow(updated);
    });
  }

  /** Delete a canned reply (ADMIN). Audited. */
  async remove(ctx: CannedActorContext, id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.cannedReply.findUnique({ where: { id } });
      if (!before || before.appKey !== ctx.appKey) {
        throw new Prisma.PrismaClientKnownRequestError("Canned reply not found", {
          code: "P2025",
          clientVersion: Prisma.prismaVersion.client,
        });
      }
      await tx.cannedReply.delete({ where: { id } });
      await this.audit.append(
        {
          actorUserId: ctx.actorUserId,
          actorEmail: ctx.actorEmail ?? null,
          appKey: ctx.appKey,
          action: AuditActions.CannedReplyDelete,
          target: id,
          before: { shortcut: before.shortcut },
          after: null,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }
}

let instance: CannedReplyService | null = null;
export function getCannedReplyService(): CannedReplyService {
  if (!instance) instance = new CannedReplyService();
  return instance;
}
