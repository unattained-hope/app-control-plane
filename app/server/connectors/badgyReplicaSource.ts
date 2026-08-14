import pg from "pg";
import type {
  CampaignMonitorStatus,
  MerchantAllowanceUsage,
  MerchantCampaignMonitor,
  MerchantCampaignSummary,
  MerchantQuery,
} from "./types.js";
import type { RawShopRow, ReplicaReadSource } from "./saleswitchConnector.js";

const { Pool } = pg;

interface ShopRow {
  shop_domain: string;
  display_name: string | null;
  owner_email: string | null;
  status: string;
  plan_name: string | null;
  plan_key: string;
  subscription_id: string | null;
  subscription_status: string | null;
  subscription_current_period_end: Date | null;
  installed_at: Date | null;
  uninstalled_at: Date | null;
  created_at: Date;
}

function mapStatus(row: ShopRow): string {
  if (row.uninstalled_at || row.status === "UNINSTALLED") return "uninstalled";
  if (row.status === "INSTALLING") return "installing";
  return "active";
}

function mapLifecycle(row: ShopRow): string {
  if (row.uninstalled_at || row.status === "UNINSTALLED") return "churned";
  if (row.status === "INSTALLING") return "onboarding";
  return "active";
}

function toRaw(row: ShopRow): RawShopRow {
  return {
    shopDomain: row.shop_domain,
    displayName: row.display_name,
    contactEmail: row.owner_email,
    status: mapStatus(row),
    lifecycle: mapLifecycle(row),
    plan: row.plan_name ?? row.plan_key,
    installedAt: row.installed_at ?? row.created_at,
    uninstalledAt: row.uninstalled_at,
  };
}

const SHOP_SELECT = `
  SELECT
    shop_domain,
    display_name,
    owner_email,
    status,
    plan_name,
    plan_key,
    subscription_id,
    subscription_status,
    subscription_current_period_end,
    installed_at,
    uninstalled_at,
    created_at
  FROM shops
`;

export interface CampaignMonitorCampaignRow {
  id: string;
  name: string;
  status: string;
  type: string;
  start_at: Date | null;
  end_at: Date | null;
  recurrence_rule: unknown | null;
  product_count: number | null;
}

export interface CampaignMonitorUsageBucketRow {
  metric: string;
  window_key: string;
  used: string | number | bigint;
}

const MONITORED_STATUSES: readonly CampaignMonitorStatus[] = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "REVERTED",
  "EARLY_REVERTED",
  "UNINSTALL_ORPHANED",
];
const LIST_LIMIT = 10;

function emptyCounts(): Record<CampaignMonitorStatus, number> {
  return Object.fromEntries(MONITORED_STATUSES.map((status) => [status, 0])) as Record<
    CampaignMonitorStatus,
    number
  >;
}

function campaignSummary(row: CampaignMonitorCampaignRow): MerchantCampaignSummary | null {
  if (!MONITORED_STATUSES.includes(row.status as CampaignMonitorStatus)) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status as CampaignMonitorStatus,
    type: row.type,
    startAt: row.start_at?.toISOString() ?? null,
    endAt: row.end_at?.toISOString() ?? null,
    recurring: row.type === "RECURRING" || row.recurrence_rule !== null,
    productCount: row.product_count,
  };
}

function finiteAllowance(
  metric: MerchantAllowanceUsage["metric"],
  used: number,
  limit: number,
  window: "LIFETIME" | "BILLING_PERIOD",
  windowEndsAt: string | null = null,
): MerchantAllowanceUsage {
  return { metric, used, limit, remaining: Math.max(0, limit - used), window, windowEndsAt };
}

function unlimitedAllowance(
  metric: MerchantAllowanceUsage["metric"],
  used: number,
): MerchantAllowanceUsage {
  return { metric, used, limit: null, remaining: null, window: "UNLIMITED", windowEndsAt: null };
}

export interface CampaignMonitorSourceData {
  readonly planKey: string;
  readonly subscriptionId: string | null;
  readonly subscriptionStatus: string | null;
  readonly subscriptionCurrentPeriodEnd: Date | null;
  readonly campaigns: readonly CampaignMonitorCampaignRow[];
  readonly buckets: readonly CampaignMonitorUsageBucketRow[];
}

/** Pure SaleSwitch-schema mapper; exported so quota/status behavior is invariant-tested. */
export function buildMerchantCampaignMonitor(
  shop: string,
  data: CampaignMonitorSourceData,
  asOf = new Date().toISOString(),
): MerchantCampaignMonitor {
  const summaries = data.campaigns
    .map(campaignSummary)
    .filter((row): row is MerchantCampaignSummary => row !== null);
  const counts = emptyCounts();
  for (const campaign of summaries) counts[campaign.status] += 1;

  const time = (value: string | null): number => value ? Date.parse(value) : Number.POSITIVE_INFINITY;
  const active = summaries
    .filter((campaign) => campaign.status === "ACTIVE")
    .sort((a, b) => time(a.startAt) - time(b.startAt))
    .slice(0, LIST_LIMIT);
  const scheduledAll = summaries
    .filter((campaign) => campaign.status === "SCHEDULED")
    .sort((a, b) => time(a.startAt) - time(b.startAt));

  const used = (metric: string, windowKey: string): number => {
    const row = data.buckets.find(
      (bucket) => bucket.metric === metric && bucket.window_key === windowKey,
    );
    return Number(row?.used ?? 0);
  };
  const plan = data.planKey.toUpperCase();
  const lifetime = "lifetime";
  const periodKey = `billing:${data.subscriptionId ?? "unknown"}:${
    data.subscriptionCurrentPeriodEnd?.toISOString() ?? "unconfirmed"
  }`;
  const lifetimeCampaigns = used("CAMPAIGN_LAUNCH", lifetime);
  const lifetimeProducts = used("PRODUCT_VARIANT_UPDATE", lifetime);
  const periodProducts = used("PRODUCT_VARIANT_UPDATE", periodKey);
  const aiCredits = used("AI_CREDIT", lifetime);
  const allowances: MerchantAllowanceUsage[] = [
    plan === "FREE"
      ? finiteAllowance("CAMPAIGN_LAUNCH", lifetimeCampaigns, 10, "LIFETIME")
      : unlimitedAllowance("CAMPAIGN_LAUNCH", lifetimeCampaigns),
    plan === "FREE"
      ? finiteAllowance("PRODUCT_VARIANT_UPDATE", lifetimeProducts, 10_000, "LIFETIME")
      : plan === "ESSENTIAL"
        ? finiteAllowance(
            "PRODUCT_VARIANT_UPDATE",
            periodProducts,
            10_000,
            "BILLING_PERIOD",
            data.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
          )
        : unlimitedAllowance("PRODUCT_VARIANT_UPDATE", lifetimeProducts),
    plan === "FREE"
      ? finiteAllowance("AI_CREDIT", aiCredits, 10, "LIFETIME")
      : unlimitedAllowance("AI_CREDIT", aiCredits),
  ];

  return {
    shop,
    plan,
    billingSuspended: plan !== "FREE" && data.subscriptionStatus === "FROZEN",
    total: summaries.length,
    counts,
    active,
    scheduled: scheduledAll.slice(0, LIST_LIMIT),
    nextScheduledAt: scheduledAll[0]?.startAt ?? null,
    allowances,
    listLimit: LIST_LIMIT,
    asOf,
  };
}

/**
 * Read-only SaleSwitch merchant source backed by Badgy's Postgres (local dev).
 * Queries the `shops` table via a dedicated pool — SELECT-only, no writes.
 * Marked replica-only so SaleSwitchConnector accepts it.
 */
export function makeBadgyReplicaSource(connectionString: string): ReplicaReadSource {
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
  });

  async function loadAll(): Promise<RawShopRow[]> {
    const result = await pool.query<ShopRow>(SHOP_SELECT);
    return result.rows.map(toRaw);
  }

  return {
    isReplicaOnly: true,

    async queryShops(q: MerchantQuery) {
      let rows = await loadAll();
      const term = q.search?.trim().toLowerCase();
      if (term) {
        rows = rows.filter(
          (r) =>
            r.shopDomain.toLowerCase().includes(term) ||
            (r.displayName?.toLowerCase().includes(term) ?? false) ||
            (r.contactEmail?.toLowerCase().includes(term) ?? false),
        );
      }
      const dir = q.sortDirection === "asc" ? 1 : -1;
      const field = q.sortField ?? "installDate";
      rows = [...rows].sort((a, b) => {
        let cmp = 0;
        if (field === "installDate") cmp = a.installedAt.getTime() - b.installedAt.getTime();
        else if (field === "plan") cmp = (a.plan ?? "").localeCompare(b.plan ?? "");
        else cmp = a.status.localeCompare(b.status);
        return cmp * dir;
      });
      const total = rows.length;
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? 25;
      const start = (page - 1) * pageSize;
      return { rows: rows.slice(start, start + pageSize), total };
    },

    async findShop(shop: string) {
      const result = await pool.query<ShopRow>(`${SHOP_SELECT} WHERE shop_domain = $1 LIMIT 1`, [
        shop,
      ]);
      const row = result.rows[0];
      return row ? toRaw(row) : null;
    },

    async getCampaignMonitor(shop: string): Promise<MerchantCampaignMonitor | null> {
      const shopResult = await pool.query<ShopRow>(`${SHOP_SELECT} WHERE shop_domain = $1 LIMIT 1`, [
        shop,
      ]);
      const shopRow = shopResult.rows[0];
      if (!shopRow) return null;

      const [campaignResult, bucketResult] = await Promise.all([
        pool.query<CampaignMonitorCampaignRow>(
          `SELECT id, name, status, type, start_at, end_at, recurrence_rule, product_count
             FROM campaigns
            WHERE shop_domain = $1 AND deleted_at IS NULL
            ORDER BY updated_at DESC`,
          [shop],
        ),
        pool.query<CampaignMonitorUsageBucketRow>(
          `SELECT metric, window_key, used
             FROM entitlement_usage_buckets
            WHERE shop_domain = $1`,
          [shop],
        ),
      ]);

      return buildMerchantCampaignMonitor(shop, {
        planKey: shopRow.plan_key,
        subscriptionId: shopRow.subscription_id,
        subscriptionStatus: shopRow.subscription_status,
        subscriptionCurrentPeriodEnd: shopRow.subscription_current_period_end,
        campaigns: campaignResult.rows,
        buckets: bucketResult.rows,
      });
    },

    async countByStatus() {
      const rows = await loadAll();
      const out: Record<string, number> = {};
      for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
      return out;
    },

    async countByPlan() {
      const rows = await loadAll();
      const out: Record<string, number> = {};
      for (const r of rows) {
        if (!r.plan) continue;
        out[r.plan] = (out[r.plan] ?? 0) + 1;
      }
      return out;
    },

    async installsSince(since: Date) {
      const rows = await loadAll();
      return rows.filter((r) => r.installedAt >= since).length;
    },

    async uninstallCount() {
      const rows = await loadAll();
      return rows.filter((r) => r.uninstalledAt !== null).length;
    },
  };
}
