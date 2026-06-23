import { test, expect } from "@playwright/test";

/**
 * cp-app-registry-connector: the top-bar app selector is driven by the App
 * registry and lists exactly the active apps. In the MVP that is SaleSwitch and
 * only SaleSwitch (the selector is disabled with a single app).
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/dev-login?role=ADMIN&to=/");
});

test("top-bar selector lists SaleSwitch and only SaleSwitch", async ({ page }) => {
  const selector = page.getByRole("combobox", { name: "Select app" });
  await expect(selector).toBeVisible();
  // SaleSwitch is the selected (and sole) option.
  await expect(selector).toContainText("SaleSwitch");
  await expect(selector.getByRole("option")).toHaveCount(1);
});
