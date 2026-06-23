import { test, expect } from "@playwright/test";

/**
 * cp-audit-log: viewing the audit log is ADMIN-only, enforced SERVER-SIDE (CASL in
 * tRPC middleware). The browser flips role via the dev switcher; the server, not
 * the UI, decides — a VIEWER gets FORBIDDEN and the page shows "ADMIN only".
 */
test("VIEWER is denied the audit log", async ({ page }) => {
  await page.goto("/dev-login?role=VIEWER&to=/audit");
  const denied = page.getByRole("alert", { name: "Audit access denied" });
  await expect(denied).toBeVisible();
  await expect(denied.getByText("ADMIN only")).toBeVisible();
  // The actual log table must NOT render for a non-admin.
  await expect(page.getByRole("table", { name: "Audit log entries" })).toHaveCount(0);
});

test("SUPPORT is denied the audit log", async ({ page }) => {
  await page.goto("/dev-login?role=SUPPORT&to=/audit");
  await expect(page.getByRole("alert", { name: "Audit access denied" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Audit log entries" })).toHaveCount(0);
});

test("ADMIN can view the audit log", async ({ page }) => {
  await page.goto("/dev-login?role=ADMIN&to=/audit");
  // No access-denied card for ADMIN; the filter + table render.
  await expect(page.getByRole("alert", { name: "Audit access denied" })).toHaveCount(0);
  await expect(page.getByRole("search", { name: "Filter audit log" })).toBeVisible();
});
