import { test, expect } from "@playwright/test";

/**
 * Tier 2 (cp-ops-monitoring / cp-webhook-reliability / cp-break-glass-rbac) e2e.
 * Proves the new ops surfaces boot and gate correctly under real RBAC via the dev
 * session, mirroring the existing audit-rbac / dashboard specs.
 */

test.describe("ops monitoring + RBAC", () => {
  test("ADMIN sees the monitoring tiles", async ({ page }) => {
    await page.goto("/dev-login?role=ADMIN&to=/monitoring");
    const main = page.getByRole("main", { name: "Monitoring" });
    await expect(main).toBeVisible();
    // Per-queue tiles render (the webhook-process queue is always present).
    await expect(main.getByText("webhook-process")).toBeVisible();
    await expect(main.getByText("Reliability")).toBeVisible();
  });

  test("VIEWER is denied the monitoring surface (ops:view required)", async ({ page }) => {
    await page.goto("/dev-login?role=VIEWER&to=/monitoring");
    const main = page.getByRole("main", { name: "Monitoring" });
    await expect(main.getByText("Ops access required")).toBeVisible();
  });

  test("the failed-delivery view renders for an ops user", async ({ page }) => {
    await page.goto("/dev-login?role=ADMIN&to=/webhook-deliveries");
    const main = page.getByRole("main", { name: "Webhook deliveries" });
    await expect(main).toBeVisible();
    // With no failures seeded it shows the clean empty state, not a crash.
    await expect(main.getByText(/No failed or dead-lettered deliveries|Loading deliveries/)).toBeVisible();
  });

  test("break-glass console lets a user request time-boxed access", async ({ page }) => {
    await page.goto("/dev-login?role=SUPPORT&to=/break-glass");
    const main = page.getByRole("main", { name: "Break-glass access" });
    await expect(main).toBeVisible();
    await expect(main.getByLabel("Reason for elevated access")).toBeVisible();
    await main.getByLabel("Reason for elevated access").fill("e2e: investigating a ticket");
    await main.getByRole("button", { name: "Request access" }).click();
    // The new ACTIVE grant (non-sensitive PII scope self-activates) appears.
    await expect(main.getByText("ACTIVE").first()).toBeVisible();
  });

  test("healthz liveness probe responds 200", async ({ request }) => {
    const res = await request.get("/healthz");
    expect(res.status()).toBe(200);
  });
});
