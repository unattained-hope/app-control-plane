import { test, expect } from "@playwright/test";

/**
 * cp-merchant-directory: the directory lists fixture merchants and narrows via
 * server-side search (search spans domain/name/email). Data comes from the
 * SaleSwitch connector's replica fixture (5 shops).
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/dev-login?role=ADMIN&to=/merchants");
});

test("lists fixture merchants", async ({ page }) => {
  const dir = page.getByRole("main", { name: "Merchant directory" });
  await expect(dir).toBeVisible();
  // Fixture merchants render as row links.
  await expect(page.getByRole("link", { name: "Open Aurora Threads" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Bold Brew Coffee" })).toBeVisible();
});

test("server-side search narrows the results", async ({ page }) => {
  await page.getByRole("searchbox", { name: "Search merchants" }).fill("aurora");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByRole("link", { name: "Open Aurora Threads" })).toBeVisible();
  // A non-matching fixture is filtered out server-side.
  await expect(page.getByRole("link", { name: "Open Bold Brew Coffee" })).toHaveCount(0);
});

test("a no-match search shows the empty state, not an error", async ({ page }) => {
  await page.getByRole("searchbox", { name: "Search merchants" }).fill("zzz-nonexistent-shop");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("status", { name: "No merchants found" })).toBeVisible();
});
