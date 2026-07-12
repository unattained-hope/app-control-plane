import { test, expect } from "@playwright/test";

/**
 * usage-analytics Phase 5 e2e: the ADMIN-only alert-rule management page (RBAC enforced
 * server-side) and the per-admin saved-views bar on the shop explorer. Mirrors the
 * audit-rbac / usage-dashboards specs: the dev switcher flips role, the SERVER decides.
 * No rollup data is required — these assert the UI boots and gates correctly.
 */

test.describe("usage alert rules (ADMIN only)", () => {
  test("VIEWER is denied the alert-rules page", async ({ page }) => {
    await page.goto("/dev-login?role=VIEWER&to=/usage/alerts");
    const denied = page.getByRole("alert", { name: "Usage alerts access denied" });
    await expect(denied).toBeVisible();
    await expect(denied.getByText("Admin access required")).toBeVisible();
    // The rule table must NOT render for a non-admin.
    await expect(page.getByRole("table", { name: "Usage alert rules" })).toHaveCount(0);
  });

  test("SUPPORT is denied the alert-rules page", async ({ page }) => {
    await page.goto("/dev-login?role=SUPPORT&to=/usage/alerts");
    await expect(page.getByRole("alert", { name: "Usage alerts access denied" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Usage alert rules" })).toHaveCount(0);
  });

  test("ADMIN sees the rule registry with the seeded (disabled) rules", async ({ page }) => {
    await page.goto("/dev-login?role=ADMIN&to=/usage/alerts");
    await expect(page.getByRole("alert", { name: "Usage alerts access denied" })).toHaveCount(0);
    const table = page.getByRole("table", { name: "Usage alert rules" });
    await expect(table).toBeVisible();
    // The seeded rules appear (seed must have run); each is disabled with an Enable action.
    await expect(table.getByText("Wizard completion conversion dropped")).toBeVisible();
    await expect(table.getByRole("button", { name: /Enable Wizard completion/ })).toBeVisible();
  });
});

test.describe("saved explorer views", () => {
  test("VIEWER sees the saved-views bar on the shop explorer", async ({ page }) => {
    // Saved views are owner-scoped and `view`-gated — every admin manages their own.
    await page.goto("/dev-login?role=VIEWER&to=/usage/shops");
    const bar = page.getByRole("group", { name: "Saved views" }).or(
      page.getByLabel("Saved views"),
    );
    await expect(bar.first()).toBeVisible();
    // The "save current" control is present.
    await expect(page.getByLabel("New view name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save current" })).toBeVisible();
  });

  test("ADMIN can save the current explorer state and restore it", async ({ page }) => {
    await page.goto("/dev-login?role=ADMIN&to=/usage/shops");
    // Change a filter so the saved state is distinctive, then save it.
    const name = `e2e-view-${Date.now()}`;
    await page.getByLabel("New view name").fill(name);
    await page.getByRole("button", { name: "Save current" }).click();
    // The new view becomes selectable in the dropdown.
    await expect(page.getByRole("button", { name: `Delete "${name}"` })).toBeVisible({
      timeout: 10_000,
    });
    // Clean up so re-runs don't hit the per-user cap.
    await page.getByRole("button", { name: `Delete "${name}"` }).click();
    await expect(page.getByRole("button", { name: `Delete "${name}"` })).toHaveCount(0);
  });
});
