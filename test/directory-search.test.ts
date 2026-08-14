import { describe, it, expect } from "vitest";
import { makeFixtureSource } from "~/server/connectors/fixtureSource.js";
import { MERCHANT_ROWS_FIXTURE } from "./fixtures/merchantRows.fixture.js";

/** cp-merchant-directory — server-side search, sort, pagination. */
describe("directory search/sort/pagination", () => {
  const source = makeFixtureSource([...MERCHANT_ROWS_FIXTURE]);

  it("starts empty unless a test injects merchant rows", async () => {
    const empty = await makeFixtureSource().queryShops({});
    expect(empty).toEqual({ rows: [], total: 0 });
  });

  it("search spans shop domain", async () => {
    const { rows } = await source.queryShops({ search: "alpha" });
    expect(rows.map((r) => r.shopDomain)).toContain("test-alpha.myshopify.com");
  });

  it("search spans email and name (not just domain)", async () => {
    const byEmail = await source.queryShops({ search: "beta@example" });
    expect(byEmail.rows.map((r) => r.shopDomain)).toContain("test-beta.myshopify.com");

    const byName = await source.queryShops({ search: "Test Gamma" });
    expect(byName.rows.map((r) => r.shopDomain)).toContain("test-gamma.myshopify.com");
  });

  it("sort by installDate desc orders newest-first", async () => {
    const { rows } = await source.queryShops({
      sortField: "installDate",
      sortDirection: "desc",
    });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.installedAt.getTime()).toBeGreaterThanOrEqual(
        rows[i]!.installedAt.getTime(),
      );
    }
  });

  it("pagination bounds the result size and reports the full total", async () => {
    const all = await source.queryShops({});
    const firstPage = await source.queryShops({ page: 1, pageSize: 2 });
    expect(firstPage.rows.length).toBe(2);
    expect(firstPage.total).toBe(all.total);

    const secondPage = await source.queryShops({ page: 2, pageSize: 2 });
    // Pages are disjoint with stable ordering.
    const overlap = firstPage.rows
      .map((r) => r.shopDomain)
      .filter((d) => secondPage.rows.some((r) => r.shopDomain === d));
    expect(overlap).toHaveLength(0);
  });

  it("empty search term returns the full set", async () => {
    const { rows, total } = await source.queryShops({ search: "   " });
    expect(rows.length).toBe(total);
  });
});
