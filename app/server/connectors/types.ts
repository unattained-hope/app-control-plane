/**
 * The per-app connector seam (cp-app-registry-connector).
 *
 * Every app maps its OWN schema -> these common shapes. The core depends ONLY on
 * this interface and NEVER references a raw app-table name or column. Onboarding a
 * second app = one new connector module + one registry row, with NO core edits
 * (proven by test/stub-connector.test.ts).
 */

export type SortDirection = "asc" | "desc";
export type MerchantSortField = "installDate" | "plan" | "status";

export interface MerchantQuery {
  /** Free-text term matched server-side against shop domain, name, AND email. */
  readonly search?: string;
  readonly sortField?: MerchantSortField;
  readonly sortDirection?: SortDirection;
  /** 1-based page. */
  readonly page?: number;
  readonly pageSize?: number;
}

/** A row in the merchant directory — the common shape, not a raw app row. */
export interface MerchantRow {
  readonly shop: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly plan: string | null;
  readonly installedAt: string; // ISO
}

export interface MerchantPage {
  readonly rows: readonly MerchantRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Replica read time, surfaced as the "as of" timestamp (cp-merchant-directory). */
  readonly asOf: string; // ISO
}

export interface MerchantDetail {
  readonly shop: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly lifecycle: string;
  readonly plan: string | null;
  readonly installedAt: string; // ISO
  readonly uninstalledAt: string | null;
  /** Deep-link to the merchant's Shopify/Partner context. */
  readonly shopifyAdminUrl: string;
  readonly asOf: string; // ISO replica read time
}

export type SubscriptionStatus = "active" | "trial" | "cancelled" | "none";

export interface SubscriptionState {
  readonly shop: string;
  readonly planName: string | null;
  readonly status: SubscriptionStatus;
  readonly price: { readonly amount: string; readonly currencyCode: string } | null;
  readonly currentPeriodStart: string | null; // ISO
  readonly currentPeriodEnd: string | null; // ISO
  /** True when served from a stale cache after a live-read failure. */
  readonly stale?: boolean;
}

export interface Kpi {
  readonly metric: string; // "active_merchants", "mrr", "plan_distribution", ...
  readonly value: number;
  readonly asOf: string; // ISO
}

/** An app-specific guarded action surfaced in the merchant detail action bar. */
export interface GuardedAction {
  readonly key: string; // "merchant.resync"
  readonly label: string;
  /** Dangerous actions are ADMIN-only; non-dangerous are SUPPORT+ (cp-merchant-actions). */
  readonly dangerous: boolean;
  /** "control-plane" writes own DB; "app-backed" calls the narrow SaleSwitch admin API. */
  readonly kind: "control-plane" | "app-backed";
}

/**
 * Read-only-ish Prisma surface a connector needs. Typed loosely as `unknown` here
 * to avoid the core importing the SaleSwitch generated client; the concrete
 * connector binds its own client. Reads are expressed through Prisma (never raw
 * SQL) so replica routing is preserved.
 */
export interface AppConnector {
  readonly key: string; // "saleswitch"
  listMerchants(q: MerchantQuery): Promise<MerchantPage>;
  getMerchant(shop: string): Promise<MerchantDetail | null>;
  getSubscription(shop: string): Promise<SubscriptionState>;
  computeKpis(): Promise<Kpi[]>;
  readonly actions: readonly GuardedAction[];
  /** Dispose the long-lived client (graceful shutdown). */
  disconnect(): Promise<void>;
}
