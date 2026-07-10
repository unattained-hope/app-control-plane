import { test, expect } from "@playwright/test";

/**
 * Tier 3 (cp-merchant-health / cp-feature-flags / cp-announcements-nps /
 * cp-self-serve-billing) e2e. Proves the growth-&-retention surfaces boot and gate
 * correctly under real RBAC via the dev session, mirroring the ops-tier2 spec.
 */

test.describe("growth & retention surfaces", () => {
  test("the at-risk list renders for any viewer", async ({ page }) => {
    await page.goto("/dev-login?role=VIEWER&to=/at-risk");
    const main = page.getByRole("main", { name: "At-risk merchants" });
    await expect(main).toBeVisible();
    // Clean empty state (or loading) until the growth rollup has scored shops.
    await expect(main.getByText(/No merchants scored yet|Loading health/)).toBeVisible();
  });

  test("ADMIN can manage feature flags; VIEWER is denied", async ({ page }) => {
    await page.goto("/dev-login?role=ADMIN&to=/feature-flags");
    const main = page.getByRole("main", { name: "Feature flags" });
    await expect(main).toBeVisible();

    const key = `e2e.flag.${Date.now()}`;
    await main.getByLabel("New flag key").fill(key);
    await main.getByRole("button", { name: "Create flag" }).click();
    await expect(main.getByText(key)).toBeVisible();

    // VIEWER lacks flags:manage and gets the explicit denial (server-enforced).
    await page.goto("/dev-login?role=VIEWER&to=/feature-flags");
    await expect(main.getByText("Admin access required")).toBeVisible();
  });

  test("ADMIN can publish an announcement", async ({ page }) => {
    await page.goto("/dev-login?role=ADMIN&to=/announcements");
    const main = page.getByRole("main", { name: "Announcements" });
    await expect(main).toBeVisible();
    await main.getByLabel("Announcement title").fill("e2e: maintenance window");
    await main.getByLabel("Announcement body").fill("We'll be upgrading tonight.");
    await main.getByRole("button", { name: "Publish to all merchants" }).click();
    await expect(main.getByText("e2e: maintenance window").first()).toBeVisible();
  });

  test("the plan-requests view renders for a viewer", async ({ page }) => {
    await page.goto("/dev-login?role=VIEWER&to=/plan-requests");
    const main = page.getByRole("main", { name: "Plan change requests" });
    await expect(main).toBeVisible();
    await expect(main.getByText(/No plan change requests|Loading requests/)).toBeVisible();
  });
});
