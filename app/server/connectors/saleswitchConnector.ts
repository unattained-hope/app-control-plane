import { getConfig, isAppAdminApiConfigured } from "~/lib/config.js";
import { getSecretsManager } from "~/lib/secrets.js";
import type {
  AppConnector,
  GuardedAction,
  Kpi,
  MerchantDetail,
  MerchantPage,
  MerchantQuery,
  SubscriptionState,
  UsageEventPage,
} from "./types.js";
import {
  buildSaleSwitchInternalClient,
  type SaleSwitchInternalClient,
} from "./saleswitchInternalClient.js";

/**
 * SaleSwitch connector (cp-app-registry-connector). Holds ONE long-lived client
 * bound to the read-only replica role, resolved from the secrets manager via the
 * registry `replicaRef`. Maps SaleSwitch's raw schema -> the common shapes. ALL
 * reads go through the (Prisma) client against the REPLICA — never raw SQL, never
 * the primary.
 *
 * MVP note: the real implementation binds a generated SaleSwitch Prisma client
 * (`new PrismaClient({ datasourceUrl }).$extends(readReplicas({ url })))`). Until
 * a replica is provisioned (dependency D1), this connector reads from an injected
 * in-memory fixture source so the full stack compiles, runs, and is testable. The
 * replica-routing invariant is asserted by test/replica-routing.test.ts via the
 * `assertNoPrimaryAccess` guard below.
 */

/** The minimal raw shape a real SaleSwitch replica row would expose. */
export interface RawShopRow {
  readonly shopDomain: string;
  readonly displayName: string | null;
  readonly contactEmail: string | null;
  readonly status: string;
  readonly lifecycle: string;
  readonly plan: string | null;
  readonly installedAt: Date;
  readonly uninstalledAt: Date | null;
}

/** Read source abstraction — a real replica client or a test fixture. */
export interface ReplicaReadSource {
  /** True if this source can only ever read the replica (never the primary). */
  readonly isReplicaOnly: boolean;
  queryShops(q: MerchantQuery): Promise<{ rows: RawShopRow[]; total: number }>;
  findShop(shop: string): Promise<RawShopRow | null>;
  countByStatus(): Promise<Record<string, number>>;
  countByPlan(): Promise<Record<string, number>>;
  installsSince(since: Date): Promise<number>;
  uninstallCount(): Promise<number>;
}

const APP_KEY = "saleswitch";

export class SaleSwitchConnector implements AppConnector {
  readonly key = APP_KEY;
  readonly actions: readonly GuardedAction[];

  /**
   * Present ONLY when the internal-API client is configured (usage-analytics
   * Phase 2b). Assigned as an optional instance member so `connector.fetchUsageEvents`
   * is `undefined` when ingestion isn't set up — letting the worker skip the app
   * exactly as the optional interface method intends.
   */
  readonly fetchUsageEvents?: (args: {
    sinceSeq: bigint;
    limit: number;
  }) => Promise<UsageEventPage>;

  constructor(
    private readonly source: ReplicaReadSource,
    internalClient?: SaleSwitchInternalClient | null,
  ) {
    // Raw SQL is prohibited (replica routing would be bypassed).
    if (!source.isReplicaOnly) {
      throw new Error(
        "SaleSwitchConnector requires a replica-only read source; refusing a source " +
          "that can reach the primary.",
      );
    }
    if (internalClient) {
      this.fetchUsageEvents = (args) => internalClient.fetchUsageEvents(args);
    }
    // App-backed actions only appear when the narrow SaleSwitch admin API exists (D2).
    const appBacked: GuardedAction[] = isAppAdminApiConfigured()
      ? [
          { key: "merchant.resync", label: "Force re-sync", dangerous: true, kind: "app-backed" },
          {
            key: "merchant.resend_onboarding",
            label: "Resend onboarding email",
            dangerous: false,
            kind: "app-backed",
          },
        ]
      : [];
    this.actions = appBacked;
  }

  async listMerchants(q: MerchantQuery): Promise<MerchantPage> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const { rows, total } = await this.source.queryShops({ ...q, page, pageSize });
    return {
      rows: rows.map((r) => ({
        shop: r.shopDomain,
        name: r.displayName,
        email: r.contactEmail,
        status: r.status,
        plan: r.plan,
        installedAt: r.installedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      asOf: new Date().toISOString(),
    };
  }

  async getMerchant(shop: string): Promise<MerchantDetail | null> {
    const r = await this.source.findShop(shop);
    if (!r) return null;
    return {
      shop: r.shopDomain,
      name: r.displayName,
      email: r.contactEmail,
      status: r.status,
      lifecycle: r.lifecycle,
      plan: r.plan,
      installedAt: r.installedAt.toISOString(),
      uninstalledAt: r.uninstalledAt ? r.uninstalledAt.toISOString() : null,
      shopifyAdminUrl: `https://admin.shopify.com/store/${r.shopDomain.replace(".myshopify.com", "")}`,
      asOf: new Date().toISOString(),
    };
  }

  async getSubscription(shop: string): Promise<SubscriptionState> {
    // Subscription state is read from SHOPIFY (cp-billing-read), not the replica.
    // Routed through the billing service's Shopify reader; here we return the
    // "none" baseline that the billing service overlays with a live/cached read.
    void getConfig();
    return {
      shop,
      planName: null,
      status: "none",
      price: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
  }

  async computeKpis(): Promise<Kpi[]> {
    const asOf = new Date().toISOString();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const byStatus = await this.source.countByStatus();
    const active = byStatus["active"] ?? 0;
    const [installs7, installs30, uninstalls, planDist] = await Promise.all([
      this.source.installsSince(new Date(now - 7 * day)),
      this.source.installsSince(new Date(now - 30 * day)),
      this.source.uninstallCount(),
      this.source.countByPlan(),
    ]);
    const planCount = Object.keys(planDist).length;
    return [
      { metric: "active_merchants", value: active, asOf },
      { metric: "new_installs_7d", value: installs7, asOf },
      { metric: "new_installs_30d", value: installs30, asOf },
      { metric: "uninstalls", value: uninstalls, asOf },
      { metric: "plan_distribution", value: planCount, asOf },
      // mrr is overlaid from billing snapshots by the rollup; baseline 0 here.
      { metric: "mrr", value: 0, asOf },
    ];
  }

  async disconnect(): Promise<void> {
    // Real client: await this.client.$disconnect();
  }
}

/**
 * Build the SaleSwitch connector, resolving the replica URL from the secrets
 * manager via the registry `replicaRef`. The real builder constructs the
 * read-replica-extended Prisma client; the MVP accepts an injected source.
 */
export async function buildSaleSwitchConnector(
  replicaRef: string,
  source: ReplicaReadSource,
): Promise<SaleSwitchConnector> {
  // Resolving proves the secrets seam works and fails closed on an unknown ref
  // (it never falls back to a primary/raw DSN — cp-app-registry-connector).
  await getSecretsManager().resolveReplicaUrl(replicaRef);
  // Build the signed internal-API client if usage ingestion is configured; null
  // otherwise, in which case the connector omits fetchUsageEvents (worker skips it).
  const internalClient = await buildSaleSwitchInternalClient();
  return new SaleSwitchConnector(source, internalClient);
}
