import { getConnector } from "../connectors/registry.js";
import { getDb } from "../db.js";
import type {
  MerchantDetail,
  MerchantPage,
  MerchantQuery,
} from "../connectors/types.js";

/**
 * Merchant directory reads (cp-merchant-directory). All merchant data is sourced
 * via the connector against the REPLICA — the control plane never writes to the
 * app DB. Notes/tags are overlaid from the control-plane DB.
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

export class MerchantService {
  /** Paginated, server-side-searched/sorted merchant list. */
  async list(appKey: string, q: MerchantQuery): Promise<MerchantPage> {
    const connector = await getConnector(appKey);
    return connector.listMerchants(q);
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
      notes: notes.map((n) => ({
        id: n.id,
        authorId: n.authorId,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      })),
      tags: tags.map((t) => t.label),
    };
  }
}

let instance: MerchantService | null = null;
export function getMerchantService(): MerchantService {
  if (!instance) instance = new MerchantService();
  return instance;
}
