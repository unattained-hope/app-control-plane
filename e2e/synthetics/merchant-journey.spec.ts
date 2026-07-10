import { test, expect } from "@playwright/test";

/**
 * Synthetic transaction check (cp-status-synthetics). Drives a real Chrome through a
 * core operator journey — sign in → merchant search → open the inbox — so the bought
 * status-page monitor can run it on a schedule and detect a broken happy-path before
 * a merchant does. Screenshots on failure are captured automatically by the
 * Playwright config (`screenshot: "only-on-failure"`) and re-attached below for the
 * synthetic monitor's failure artifact.
 *
 * For production synthetics, point the monitor at the deployed environment (override
 * `baseURL` / run with a prod Playwright config); in-repo it reuses the dev harness.
 */
test.describe("synthetic: operator journey", () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      // Attach a screenshot to the synthetic run's failure artifact.
      await testInfo.attach("synthetic-failure", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  });

  test("sign in, search merchants, open the inbox", async ({ page }) => {
    // 1. Sign in (dev session in-repo; SSO in prod).
    await page.goto("/dev-login?role=SUPPORT&to=/");
    await expect(page.getByRole("main", { name: "KPI dashboard" })).toBeVisible();

    // 2. Merchant search.
    await page.goto("/merchants");
    const directory = page.getByRole("main", { name: "Merchant directory" });
    await expect(directory).toBeVisible();
    await page.getByRole("searchbox", { name: "Search merchants" }).fill("aurora");

    // 3. Open the inbox and confirm its search surface renders.
    await page.goto("/inbox");
    await expect(page.getByRole("searchbox", { name: "Search conversations" })).toBeVisible();
  });
});
