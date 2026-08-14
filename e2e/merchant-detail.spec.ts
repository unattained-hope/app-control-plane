import { test, expect } from "@playwright/test";

const SHOP = "missing-test-shop.myshopify.com";

/**
 * cp-merchant-directory: empty fixture mode must not invent merchant details.
 */
test.beforeEach(async ({ page }) => {
  await page.goto(`/dev-login?role=ADMIN&to=/merchants/${SHOP}`);
});

test("unknown merchant renders the not-found state", async ({ page }) => {
  await expect(page.getByRole("status", { name: "Merchant not found" })).toBeVisible();
});
