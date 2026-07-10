import type { Announcement, AnnouncementAudience } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { getConversationService, type ConversationService } from "./conversationService.js";
import { AuditActions } from "~/lib/auditActions.js";
import { captureError } from "~/lib/observability.js";

/**
 * In-app announcements (cp-announcements-nps). An authorized user publishes a CP-owned
 * `Announcement`; it is broadcast over the existing chat gateway (a Socket.IO
 * `announcement` event, Redis-fanned) and a `SYSTEM` message is persisted per targeted
 * conversation so it appears in history. Honors `expiresAt`. Publishing is audited.
 * Rich changelog/NPS platforms are out of scope (roadmap "buy").
 */

export interface AnnouncementActor {
  readonly id: string;
  readonly email?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface PublishInput {
  readonly title: string;
  readonly body: string;
  readonly audience: AnnouncementAudience;
  /** Plan name (PLAN) or comma-separated shops (SHOP_LIST); ignored for ALL. */
  readonly audienceValue?: string | null;
  readonly expiresAt?: Date | null;
}

/** Emit-to-widgets seam (the chat gateway's io). Null in tests / before attach. */
export interface AnnouncementBroadcaster {
  emit(event: "announcement", payload: unknown): void;
}

export class AnnouncementService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
    private readonly conversations: ConversationService = getConversationService(),
    private readonly broadcaster: () => AnnouncementBroadcaster | null = defaultBroadcaster,
  ) {}

  /** Publish + broadcast + audit (announcement record + audit in the same tx). */
  async publish(
    actor: AnnouncementActor,
    appKey: string,
    input: PublishInput,
    now: Date = new Date(),
  ): Promise<Announcement> {
    const announcement = await this.db.$transaction(async (tx) => {
      const created = await tx.announcement.create({
        data: {
          appKey,
          title: input.title,
          body: input.body,
          audience: input.audience,
          audienceValue: input.audienceValue ?? null,
          createdBy: actor.id,
          publishedAt: now,
          expiresAt: input.expiresAt ?? null,
        },
      });
      await this.audit.append(
        {
          actorUserId: actor.id,
          actorEmail: actor.email ?? null,
          appKey,
          action: AuditActions.AnnouncementPublish,
          target: created.id,
          before: null,
          after: { audience: input.audience, audienceValue: input.audienceValue ?? null },
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
        tx,
      );
      return created;
    });

    // Persist a SYSTEM message per targeted conversation so it shows in history.
    // Best-effort — a delivery failure must not roll back the published announcement.
    try {
      await this.fanOutSystemMessages(appKey, announcement);
    } catch (err) {
      captureError(err, { where: "announcementService.fanOut", id: announcement.id });
    }

    // Broadcast to connected widgets (Redis-fanned across instances).
    this.broadcaster()?.emit("announcement", {
      id: announcement.id,
      appKey,
      title: announcement.title,
      body: announcement.body,
      audience: announcement.audience,
      audienceValue: announcement.audienceValue,
    });

    return announcement;
  }

  /** Resolve the audience to conversations and persist a `SYSTEM` message in each. */
  private async fanOutSystemMessages(appKey: string, a: Announcement): Promise<void> {
    const targetShops = await this.resolveShops(appKey, a);
    for (const shop of targetShops) {
      const convo = await this.conversations.getOrCreateForShop(appKey, shop);
      await this.conversations.persistMessage({
        conversationId: convo.id,
        senderType: "SYSTEM",
        senderId: "system:announcement",
        body: `📣 ${a.title}\n\n${a.body}`,
      });
    }
  }

  /**
   * Resolve the announcement audience to a set of shop domains.
   * - SHOP_LIST → the comma-separated `audienceValue`;
   * - ALL → every shop with an existing conversation in the app;
   * - PLAN → best-effort: shops with existing conversations (plan filtering is a
   *   bought-platform concern; documented limitation), so the broadcast still reaches
   *   connected widgets carrying the plan in its payload.
   */
  private async resolveShops(appKey: string, a: Announcement): Promise<string[]> {
    if (a.audience === "SHOP_LIST") {
      return (a.audienceValue ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    const convos = await this.conversations.listConversations(appKey);
    return [...new Set(convos.map((c) => c.shop))];
  }

  /** Active (published, not expired) announcements, newest first. */
  async listActive(appKey: string, now: Date = new Date()): Promise<Announcement[]> {
    const rows = await this.db.announcement.findMany({
      where: { appKey },
      orderBy: { publishedAt: "desc" },
    });
    return rows.filter(
      (r) => r.publishedAt != null && (r.expiresAt == null || r.expiresAt > now),
    );
  }

  /** All announcements for the admin history, newest first. */
  async list(appKey: string): Promise<Announcement[]> {
    return this.db.announcement.findMany({
      where: { appKey },
      orderBy: { publishedAt: "desc" },
      take: 200,
    });
  }
}

/** Resolve the chat gateway's io lazily (null in tests / before the gateway attaches). */
function defaultBroadcaster(): AnnouncementBroadcaster | null {
  // Lazy require avoids a hard import cycle web ⇄ realtime and keeps tests DB/socket-free.
  // The gateway sets the singleton when it attaches; null => no connected transport.
  return getChatBroadcaster();
}

let chatBroadcaster: AnnouncementBroadcaster | null = null;
/** Called by the chat gateway when it attaches, so the service can broadcast. */
export function setChatBroadcaster(b: AnnouncementBroadcaster | null): void {
  chatBroadcaster = b;
}
function getChatBroadcaster(): AnnouncementBroadcaster | null {
  return chatBroadcaster;
}

let instance: AnnouncementService | null = null;
export function getAnnouncementService(): AnnouncementService {
  if (!instance) instance = new AnnouncementService();
  return instance;
}
