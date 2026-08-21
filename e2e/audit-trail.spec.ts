import { test, expect } from "@playwright/test";

test.describe("Audit Log Point-by-Point Trail & Split View", () => {
  test("ADMIN can browse audit trails by handler, store, and category", async ({ page }) => {
    await page.goto("/dev-login?role=ADMIN&to=/audit");

    // Header and filter search form exist
    await expect(page.getByText("Audit Trail & Activity Log")).toBeVisible();
    await expect(page.getByRole("search", { name: "Filter audit log" })).toBeVisible();

    // Mode tabs are visible
    const handlersTab = page.getByRole("button", { name: /Handlers/i });
    const storesTab = page.getByRole("button", { name: /Stores/i });
    const categoriesTab = page.getByRole("button", { name: /Categories/i });
    const allActivityTab = page.getByRole("button", { name: /All Activity/i });

    await expect(handlersTab).toBeVisible();
    await expect(storesTab).toBeVisible();
    await expect(categoriesTab).toBeVisible();
    await expect(allActivityTab).toBeVisible();

    // Switching to Stores tab
    await storesTab.click();
    await expect(page.getByPlaceholder("Filter stores…")).toBeVisible();

    // Switching to Categories tab
    await categoriesTab.click();
    await expect(page.getByPlaceholder("Filter categories…")).toBeVisible();

    // Switching to All Activity tab
    await allActivityTab.click();
    await expect(page.getByText("Unified Chronological Stream")).toBeVisible();

    // Switch view format to Table View
    const tableViewBtn = page.getByRole("button", { name: "Table View" });
    await tableViewBtn.click();
    await expect(page.getByRole("table", { name: "Audit log entries" })).toBeVisible();

    // Switch back to Split Trail View
    const trailViewBtn = page.getByRole("button", { name: "Split Trail View" });
    await trailViewBtn.click();
    await expect(page.getByRole("table", { name: "Audit log entries" })).toHaveCount(0);

    // Switch to dark mode
    const darkRadio = page.getByRole("radio", { name: "Dark" });
    await darkRadio.click();

    // Save screenshot for visual verification
    await page.screenshot({ path: "test-results/audit-trail-visual-check.png", fullPage: true });
  });
});
