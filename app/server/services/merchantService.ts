import { getConnector } from "../connectors/registry.js";
import { getDb } from "../db.js";
import { maskEmail } from "~/lib/pii.js";
import { getConversationService, type ConversationListRow } from "./conversationService.js";
import { getAuditService, type AuditRow } from "./auditService.js";
import type {
  MerchantDetail,
  MerchantPage,
  MerchantQuery,
} from "../connectors/types.js";

/**
 * Merchant directory reads (cp-merchant-directory). All merchant data is sourced
 * via the connector against the REPLICA — the control plane never writes to the
 * app DB. Notes/tags are overlaid from the control-plane DB.
 *
 * PII (cp-pii-governance): merchant email is MASKED by default here — the single
 * server-side choke point — so an unauthorized caller never receives the raw value.
 * The unmasked value is only returned via the audited `revealPii` mutation.
 */
export interface MerchantDetailView extends MerchantDetail {
  readonly notes: readonly {
    readonly id: string;
    readonly authorId: string;
    readonly body: string;
    readonly createdAt: string;
  }[];
  readonly tags: readonly string[];
}

/**
 * The unified Merchant 360 surface (cp-merchant-360): the detail view plus the
 * shop's conversation history and per-shop audit trail. Composed read-only — every
 * app-data read goes through the connector replica; conversations/notes/tags/audit
 * are control-plane-owned. `asOf` (inherited from the connector read) discloses
 * replica lag.
 */
export interface MerchantOverview extends MerchantDetailView {
  readonly conversations: readonly ConversationListRow[];
  readonly audit: readonly AuditRow[];
}

export class MerchantService {
  /** Paginated, server-side-searched/sorted merchant list (email masked). */
  async list(appKey: string, q: MerchantQuery): Promise<MerchantPage> {
    const connector = await getConnector(appKey);
    const page = await connector.listMerchants(q);
    return {
      ...page,
      rows: page.rows.map((r) => ({ ...r, email: maskEmail(r.email) })),
    };
  }

  /**
   * Merchant detail merging replica-sourced shop data with control-plane-owned
   * notes and tags. Returns null when the shop is not found in the replica.
   */
  async detail(appKey: string, shop: string): Promise<MerchantDetailView | null> {
    const connector = await getConnector(appKey);
    const base = await connector.getMerchant(shop);
    if (!base) return null;

    const db = getDb();
    const [notes, tags] = await Promise.all([
      db.merchantNote.findMany({
        where: { appKey, shop },
        orderBy: { createdAt: "desc" },
      }),
      db.merchantTag.findMany({ where: { appKey, shop }, orderBy: { label: "asc" } }),
    ]);

    return {
      ...base,
      email: maskEmail(base.email), // masked by default (cp-pii-governance)
      notes: notes.map((n) => ({
        id: n.id,
        authorId: n.authorId,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      })),
      tags: tags.map((t) => t.label),
    };
  }

  /**
   * Merchant 360 (cp-merchant-360): the detail view + the shop's conversation
   * history + the per-shop audit trail, composed in parallel. Read-only; returns
   * null when the shop is not found in the replica. PII stays masked here — the
   * unmasked value is only ever returned through the audited `revealPii` path.
   */
  async overview(appKey: string, shop: string): Promise<MerchantOverview | null> {
    const view = await this.detail(appKey, shop);
    if (!view) return null;
    const [conversations, audit] = await Promise.all([
      getConversationService().listForShop(appKey, shop),
      getAuditService().query({ appKey, merchantShop: shop, limit: 50 }),
    ]);
    return { ...view, conversations, audit };
  }
}

let instance: MerchantService | null = null;
export function getMerchantService(): MerchantService {
  if (!instance) instance = new MerchantService();
  return instance;
}
