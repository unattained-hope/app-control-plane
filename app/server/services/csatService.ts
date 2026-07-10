import { Prisma } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * Post-close CSAT capture (cp-conversation-csat). Merchant-submitted via the widget
 * transport. Score is validated 1–5 and recording is IDEMPOTENT — once a score
 * exists it is never silently overwritten. Audited as a merchant/system event.
 */

export class InvalidCsatScoreError extends Error {
  readonly code = "INVALID_CSAT_SCORE";
  constructor() {
    super("CSAT score must be an integer between 1 and 5.");
  }
}

export class CsatService {
  constructor(
    private readonly db = getDb(),
    private readonly audit = getAuditService(),
  ) {}

  /**
   * Record a CSAT score (+ optional comment). Returns `{ recorded }` — false when a
   * score already existed (idempotent no-op). Validates 1–5; audits on record.
   */
  async record(
    conversationId: string,
    score: number,
    comment?: string | null,
  ): Promise<{ recorded: boolean }> {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new InvalidCsatScoreError();
    }
    return this.db.$transaction(async (tx) => {
      const convo = await tx.conversation.findUnique({ where: { id: conversationId } });
      if (!convo) {
        throw new Prisma.PrismaClientKnownRequestError("Conversation not found", {
          code: "P2025",
          clientVersion: Prisma.prismaVersion.client,
        });
      }
      // Idempotent: preserve the first score.
      if (convo.csatScore != null) return { recorded: false };

      await tx.conversation.update({
        where: { id: conversationId },
        data: { csatScore: score, csatComment: comment ?? null },
      });
      await this.audit.append(
        {
          actorUserId: `merchant:${convo.shop}`,
          actorType: "SYSTEM",
          source: "API",
          appKey: convo.appKey,
          merchantShop: convo.shop,
          action: AuditActions.ConversationCsatRecorded,
          target: conversationId,
          before: null,
          after: { score },
        },
        tx,
      );
      return { recorded: true };
    });
  }
}

let instance: CsatService | null = null;
export function getCsatService(): CsatService {
  if (!instance) instance = new CsatService();
  return instance;
}
