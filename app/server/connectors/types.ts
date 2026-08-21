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
  readonly avatarUrl?: string | null;
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
  readonly avatarUrl?: string | null;
}

export type CampaignMonitorStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "REVERTED"
  | "EARLY_REVERTED"
  | "UNINSTALL_ORPHANED";

export interface MerchantCampaignSummary {
  readonly id: string;
  readonly name: string;
  readonly status: CampaignMonitorStatus;
  readonly type: string;
  readonly startAt: string | null;
  readonly endAt: string | null;
  readonly recurring: boolean;
  readonly productCount: number | null;
}

export type MerchantAllowanceMetric =
  | "CAMPAIGN_LAUNCH"
  | "PRODUCT_VARIANT_UPDATE"
  | "AI_CREDIT";

export interface MerchantAllowanceUsage {
  readonly metric: MerchantAllowanceMetric;
  readonly used: number;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly window: "LIFETIME" | "BILLING_PERIOD" | "UNLIMITED";
  readonly windowEndsAt: string | null;
}

export interface MerchantCampaignMonitor {
  readonly shop: string;
  readonly plan: string;
  readonly billingSuspended: boolean;
  readonly total: number;
  readonly counts: Readonly<Record<CampaignMonitorStatus, number>>;
  readonly active: readonly MerchantCampaignSummary[];
  readonly scheduled: readonly MerchantCampaignSummary[];
  readonly nextScheduledAt: string | null;
  readonly allowances: readonly MerchantAllowanceUsage[];
  readonly listLimit: number;
  readonly asOf: string;
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
 * One usage event as exported by an app (usage-analytics Phase 2b). A plain
 * common shape — deliberately NOT imported from the app; the app maps its own
 * columns to this. `seq` is the source's monotonic cursor value; it is a string
 * on the wire because it is a BigInt (JSON has no native BigInt).
 */
export interface MirroredUsageEvent {
  readonly id: string; // the source's per-event id — the dedupe key
  readonly seq: string; // monotonic cursor value, BigInt-as-string
  readonly shopDomain: string;
  readonly userId: string | null;
  readonly name: string;
  readonly category: string;
  readonly source: string;
  readonly properties: Record<string, unknown> | null;
  readonly impersonated: boolean;
  readonly occurredAt: string; // ISO
}

/** One cursor page of usage events. `nextSinceSeq` is a BigInt-as-string. */
export interface UsageEventPage {
  readonly events: readonly MirroredUsageEvent[];
  readonly nextSinceSeq: string;
  readonly hasMore: boolean;
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
  /** Optional app-specific live campaign/quota read for the merchant 360 view. */
  getCampaignMonitor?(shop: string): Promise<MerchantCampaignMonitor | null>;
  getSubscription(shop: string): Promise<SubscriptionState>;
  computeKpis(): Promise<Kpi[]>;
  readonly actions: readonly GuardedAction[];
  /**
   * Pull a cursor page of usage events (usage-analytics Phase 2b). OPTIONAL: an
   * app that doesn't emit usage events omits it, and the ingest worker skips it.
   * `sinceSeq` is an exclusive lower bound; `limit` is a hint the endpoint may cap.
   */
  fetchUsageEvents?(args: {
    readonly sinceSeq: bigint;
    readonly limit: number;
  }): Promise<UsageEventPage>;
  /** Dispose the long-lived client (graceful shutdown). */
  disconnect(): Promise<void>;
}
