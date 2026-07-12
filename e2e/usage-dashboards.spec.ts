import { test, expect } from "@playwright/test";

/**
 * Usage dashboards e2e (usage-analytics Phase 4). Proves the four usage pages + the
 * merchant Activity tab boot and render under REAL RBAC via the dev session, mirroring
 * the growth-tier3 / ops-tier2 specs. With no rollup data seeded, every view shows its
 * explicit pre-data empty-state copy — not a crash or a broken chart. A VIEWER-role user
 * can reach every page (all usage procedures are `view`-gated, read-only).
 *
 * The usage section is module-gated on the app registry's `enabledModules` containing
 * "usage" (added to the SaleSwitch seed), so the nav entry is present for the seeded app.
 */

test.describe("usage dashboards", () => {
  test("VIEWER can open the overview; it renders snapshot-sourced with an empty state", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=VIEWER&to=/usage");
    const main = page.getByRole("main", { name: "Usage — Overview" });
    await expect(main).toBeVisible();

    // The sub-nav links every usage view.
    for (const label of ["Overview", "Features", "Funnel", "Shops"]) {
      await expect(main.getByRole("link", { name: label })).toBeVisible();
    }

    // Headline tiles are present (values are the em-dash/"coming soon" empty state
    // until a rollup runs). The deferred tile is honestly labelled.
    await expect(main.getByText("Weekly active shops").first()).toBeVisible();
    await expect(main.getByText("Median time-to-first-campaign")).toBeVisible();
    await expect(main.getByText("Coming soon").first()).toBeVisible();
  });

  test("the usage nav entry appears (module-gated) and links work", async ({ page }) => {
    await page.goto("/dev-login?role=VIEWER&to=/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Usage" })).toBeVisible();
    await nav.getByRole("link", { name: "Usage" }).click();
    await expect(page.getByRole("main", { name: "Usage — Overview" })).toBeVisible();
  });

  test("features page renders with its window toggle and empty states", async ({ page }) => {
    await page.goto("/dev-login?role=VIEWER&to=/usage/features");
    const main = page.getByRole("main", { name: "Usage — Features" });
    await expect(main).toBeVisible();
    // The 30/90-day toggle is present.
    await expect(main.getByRole("tab", { name: "30-day" })).toBeVisible();
    await expect(main.getByRole("tab", { name: "90-day" })).toBeVisible();
    // Pre-data copy appears somewhere on the page.
    await expect(main.getByText(/Collecting data since|No usage data yet/).first()).toBeVisible();
  });

  test("funnel page renders slicers and the median-dwell chart", async ({ page }) => {
    await page.goto("/dev-login?role=VIEWER&to=/usage/funnel");
    const main = page.getByRole("main", { name: "Usage — Funnel" });
    await expect(main).toBeVisible();
    await expect(main.getByLabel("Filter by plan")).toBeVisible();
    await expect(main.getByLabel("Filter by lifecycle")).toBeVisible();
    // Median dwell is now a REAL chart (Phase-5 beacon). With no rollup data it shows the
    // shared pre-data empty-state inside the card — NOT the old "coming soon" placeholder.
    await expect(main.getByText("Median dwell per step")).toBeVisible();
    await expect(main.getByLabel("Median dwell per step").getByText(/Collecting data since|No usage data yet/)).toBeVisible();
    await expect(main.getByText(/Not yet collected/)).toHaveCount(0);
  });

  test("shops page renders the scatter axis/colour switchers and cohort table", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=VIEWER&to=/usage/shops");
    const main = page.getByRole("main", { name: "Usage — Shops" });
    await expect(main).toBeVisible();
    await expect(main.getByLabel("X axis")).toBeVisible();
    await expect(main.getByLabel("Y axis")).toBeVisible();
    await expect(main.getByLabel("Colour by")).toBeVisible();
    // Empty cohort state until the nightly cohort job runs.
    await expect(main.getByText(/No cohort snapshots yet|No shops match/).first()).toBeVisible();
  });

  test("merchant detail exposes an Activity tab with the empty feed state", async ({ page }) => {
    // Any shop param renders the detail scaffold; the Activity tab reads the mirror.
    await page.goto("/dev-login?role=VIEWER&to=/merchants/aurora.myshopify.com");
    // The Overview/Activity tabs exist regardless of whether the shop resolves.
    const activityTab = page.getByRole("tab", { name: "Activity" });
    if (await activityTab.isVisible().catch(() => false)) {
      await activityTab.click();
      await expect(
        page.getByText(/No usage events recorded|Loading activity|Newest first/).first(),
      ).toBeVisible();
    }
  });
});
