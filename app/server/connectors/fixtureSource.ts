import type { MerchantQuery } from "./types.js";
import type {
  RawShopRow,
  ReplicaReadSource,
} from "./saleswitchConnector.js";

/**
 * In-memory replica source for isolated tests. It intentionally starts empty so
 * selecting `fixture` can never surface invented merchants in the application.
 * Tests that need rows inject test-local data explicitly.
 */
export function makeFixtureSource(seed: RawShopRow[] = []): ReplicaReadSource {
  const data = [...seed];

  return {
    isReplicaOnly: true,

    async queryShops(q: MerchantQuery) {
      let rows = data;
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
      return data.find((r) => r.shopDomain === shop) ?? null;
    },

    async countByStatus() {
      const out: Record<string, number> = {};
      for (const r of data) out[r.status] = (out[r.status] ?? 0) + 1;
      return out;
    },

    async countByPlan() {
      const out: Record<string, number> = {};
      for (const r of data) {
        if (!r.plan) continue;
        out[r.plan] = (out[r.plan] ?? 0) + 1;
      }
      return out;
    },

    async installsSince(since: Date) {
      return data.filter((r) => r.installedAt >= since).length;
    },

    async uninstallCount() {
      return data.filter((r) => r.uninstalledAt !== null).length;
    },
  };
}
