import { test, expect } from "@playwright/test";

/**
 * cp-merchant-directory: an explicitly selected empty fixture renders honestly;
 * synthetic merchants must never appear in the application directory.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/dev-login?role=ADMIN&to=/merchants");
});

test("does not list synthetic merchants", async ({ page }) => {
  const dir = page.getByRole("main", { name: "Merchant directory" });
  await expect(dir).toBeVisible();
  await expect(page.getByRole("status", { name: "No merchants found" })).toBeVisible();
});

test("a no-match search shows the empty state, not an error", async ({ page }) => {
  await page.getByRole("searchbox", { name: "Search merchants" }).fill("zzz-nonexistent-shop");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("status", { name: "No merchants found" })).toBeVisible();
});
