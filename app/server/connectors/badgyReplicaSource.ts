import pg from "pg";
import type { MerchantQuery } from "./types.js";
import type { RawShopRow, ReplicaReadSource } from "./saleswitchConnector.js";

const { Pool } = pg;

interface ShopRow {
  shop_domain: string;
  display_name: string | null;
  owner_email: string | null;
  status: string;
  plan_name: string | null;
  plan_key: string;
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
    installed_at,
    uninstalled_at,
    created_at
  FROM shops
`;

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
