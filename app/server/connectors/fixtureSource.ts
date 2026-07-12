import type { MerchantQuery } from "./types.js";
import type {
  RawShopRow,
  ReplicaReadSource,
} from "./saleswitchConnector.js";

/**
 * In-memory replica fixture (cp-app-registry-connector). Stands in for the
 * SaleSwitch read-replica until D1 provisions one. It is `isReplicaOnly: true`
 * because it CANNOT reach a primary — satisfying the replica-routing invariant.
 *
 * Performs the same server-side filter/sort/paginate the real connector pushes
 * to the replica, so directory behavior (search across domain/name/email, sort,
 * pagination) is exercised end-to-end without a database.
 */
function mk(
  shopDomain: string,
  displayName: string | null,
  contactEmail: string | null,
  status: string,
  lifecycle: string,
  plan: string | null,
  installedDaysAgo: number,
  uninstalledDaysAgo: number | null,
): RawShopRow {
  const day = 24 * 60 * 60 * 1000;
  const base = Date.UTC(2026, 5, 22); // fixed clock so fixtures are deterministic
  return {
    shopDomain,
    displayName,
    contactEmail,
    status,
    lifecycle,
    plan,
    installedAt: new Date(base + installedDaysAgo * day),
    uninstalledAt: uninstalledDaysAgo === null ? null : new Date(base + uninstalledDaysAgo * day),
  };
}

/** Deterministic fixture merchants for tests / non-dev environments. */
export function defaultFixtureSeed(): RawShopRow[] {
  return [
    mk("aurora-threads.myshopify.com", "Aurora Threads", "owner@aurora.test", "active", "active", "Pro", 120, null),
    mk("bold-brew-coffee.myshopify.com", "Bold Brew Coffee", "hello@boldbrew.test", "active", "active", "Starter", 90, null),
    mk("cascade-outdoors.myshopify.com", "Cascade Outdoors", "team@cascade.test", "active", "active", "Pro", 60, null),
    mk("delta-digital.myshopify.com", "Delta Digital", "ops@delta.test", "installing", "onboarding", null, 7, null),
    mk("ember-home.myshopify.com", "Ember Home", "support@ember.test", "uninstalled", "churned", "Starter", 200, 14),
  ];
}

export function makeFixtureSource(seed: RawShopRow[] = defaultFixtureSeed()): ReplicaReadSource {
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
