import type { AdminIdentity } from "../auth.js";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import { getBreakGlassService } from "./breakGlassService.js";
import { getConnector } from "../connectors/registry.js";
import { getConfig, isAppAdminApiConfigured } from "~/lib/config.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * Merchant actions (cp-merchant-actions). Two classes:
 *  - control-plane-owned (notes, tags): write the control-plane DB.
 *  - app-backed (resync, resend onboarding): call the narrow SaleSwitch admin API.
 *
 * INVARIANTS:
 *  - Every action writes an AuditLog row in the SAME transaction as its effect;
 *    if the audit insert fails, the action rolls back (AC4.4).
 *  - A type-to-confirm guard must pass before any side effect (AC4.3).
 *  - Dangerous actions are ADMIN-only; role enforcement is in the router (CASL),
 *    re-asserted here as defense-in-depth.
 *  - The control plane NEVER mutates the app DB directly (AC4.2).
 */
export interface ActionContext {
  readonly actor: AdminIdentity;
  readonly appKey: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** The exact text the user typed to confirm. */
  readonly confirmText: string;
}

export class ConfirmationError extends Error {
  readonly code = "CONFIRMATION_REQUIRED";
  constructor() {
    super("Confirmation text did not match; action not run.");
  }
}

export class AppApiUnavailableError extends Error {
  readonly code = "APP_API_UNAVAILABLE";
  constructor() {
    super("SaleSwitch admin API is not configured; app-backed actions are unavailable.");
  }
}

export class ReasonRequiredError extends Error {
  readonly code = "REASON_REQUIRED";
  constructor() {
    super("A reason is required to reveal protected customer data.");
  }
}

function assertConfirmed(ctx: ActionContext, expected: string): void {
  if (ctx.confirmText.trim() !== expected) {
    throw new ConfirmationError();
  }
}

export class MerchantActionService {
  private readonly db = getDb();
  private readonly audit = getAuditService();
  private readonly breakGlass = getBreakGlassService();

  /** Add a note. Audited in the same transaction. */
  async addNote(ctx: ActionContext, shop: string, body: string): Promise<{ id: string }> {
    assertConfirmed(ctx, shop);
    return this.db.$transaction(async (tx) => {
      const note = await tx.merchantNote.create({
        data: { appKey: ctx.appKey, shop, authorId: ctx.actor.id, body },
      });
      await this.audit.append(
        {
          actorUserId: ctx.actor.id,
          actorEmail: ctx.actor.email,
          appKey: ctx.appKey,
          merchantShop: shop,
          action: AuditActions.MerchantNoteAdd,
          target: note.id,
          before: null,
          after: { body },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return { id: note.id };
    });
  }

  /** Edit a note, capturing before/after. Audited in the same transaction. */
  async editNote(ctx: ActionContext, noteId: string, body: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.merchantNote.findUnique({ where: { id: noteId } });
      if (!existing || existing.appKey !== ctx.appKey) {
        throw new Error("Note not found");
      }
      assertConfirmed(ctx, existing.shop);
      await tx.merchantNote.update({ where: { id: noteId }, data: { body } });
      await this.audit.append(
        {
          actorUserId: ctx.actor.id,
          actorEmail: ctx.actor.email,
          appKey: ctx.appKey,
          merchantShop: existing.shop,
          action: AuditActions.MerchantNoteEdit,
          target: noteId,
          before: { body: existing.body },
          after: { body },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /** Add a tag. Audited in the same transaction. */
  async addTag(ctx: ActionContext, shop: string, label: string): Promise<void> {
    assertConfirmed(ctx, shop);
    await this.db.$transaction(async (tx) => {
      await tx.merchantTag.create({ data: { appKey: ctx.appKey, shop, label } });
      await this.audit.append(
        {
          actorUserId: ctx.actor.id,
          actorEmail: ctx.actor.email,
          appKey: ctx.appKey,
          merchantShop: shop,
          action: AuditActions.MerchantTagAdd,
          target: label,
          before: null,
          after: { label },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /** Remove a tag, capturing the removed value. Audited in the same transaction. */
  async removeTag(ctx: ActionContext, shop: string, label: string): Promise<void> {
    assertConfirmed(ctx, shop);
    await this.db.$transaction(async (tx) => {
      await tx.merchantTag.delete({
        where: { appKey_shop_label: { appKey: ctx.appKey, shop, label } },
      });
      await this.audit.append(
        {
          actorUserId: ctx.actor.id,
          actorEmail: ctx.actor.email,
          appKey: ctx.appKey,
          merchantShop: shop,
          action: AuditActions.MerchantTagRemove,
          target: label,
          before: { label },
          after: null,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /**
   * Dispatch an app-backed action to the narrow SaleSwitch admin API. Never
   * touches the app DB directly. The outcome (success OR failure) is always
   * audited (AC4.4 app-backed scenario).
   */
  async dispatchAppBacked(
    ctx: ActionContext,
    shop: string,
    actionKey: string,
  ): Promise<{ ok: boolean }> {
    if (!isAppAdminApiConfigured()) {
      throw new AppApiUnavailableError();
    }
    assertConfirmed(ctx, shop);
    const cfg = getConfig();
    let ok = false;
    let errorDetail: string | null = null;
    try {
      const res = await fetch(`${cfg.SALESWITCH_ADMIN_API_URL}/admin/${actionKey}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.SALESWITCH_ADMIN_API_TOKEN ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ shop }),
      });
      ok = res.ok;
      if (!ok) errorDetail = `HTTP ${res.status}`;
    } catch (err) {
      ok = false;
      errorDetail = err instanceof Error ? err.message : "unknown error";
    }
    // Audit the attempt + outcome regardless of success.
    await this.audit.append({
      actorUserId: ctx.actor.id,
      actorEmail: ctx.actor.email,
      appKey: ctx.appKey,
      merchantShop: shop,
      action: `merchant.${actionKey}`,
      target: shop,
      before: null,
      after: { ok, error: errorDetail },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok };
  }

  /**
   * Reveal a merchant's unmasked PII (cp-pii-governance). Returns the raw value AND
   * writes exactly one `merchant.pii.view` audit row capturing the actor, target,
   * and a REQUIRED typed reason — the "access log to protected customer data" Level-2
   * control. Role enforcement (`pii:view`) happens in the router; a missing reason is
   * rejected here before any value is read. Reads the value via the connector
   * (replica) — the masked read path is bypassed only through this audited call.
   */
  async revealPii(
    ctx: Omit<ActionContext, "confirmText">,
    shop: string,
    reason: string,
  ): Promise<{ field: "email"; value: string | null }> {
    if (!reason.trim()) {
      throw new ReasonRequiredError();
    }
    // Justified, time-boxed access (cp-break-glass-rbac): `pii:view` makes the actor
    // ELIGIBLE; a live break-glass grant authorizes the reveal RIGHT NOW. No active
    // grant ⇒ FORBIDDEN (the UI requests one — with this same reason — first).
    await this.breakGlass.requireActiveGrant(ctx.appKey, ctx.actor.id, "PII_REVEAL", shop);
    const connector = await getConnector(ctx.appKey);
    const detail = await connector.getMerchant(shop);
    const value = detail?.email ?? null;
    await this.audit.append({
      actorUserId: ctx.actor.id,
      actorEmail: ctx.actor.email,
      appKey: ctx.appKey,
      merchantShop: shop,
      action: AuditActions.MerchantPiiView,
      target: shop,
      before: null,
      after: { field: "email", reason: reason.trim() },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { field: "email", value };
  }
}

let instance: MerchantActionService | null = null;
export function getMerchantActionService(): MerchantActionService {
  if (!instance) instance = new MerchantActionService();
  return instance;
}
