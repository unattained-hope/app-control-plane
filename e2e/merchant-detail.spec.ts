import { test, expect } from "@playwright/test";

const SHOP = "aurora-threads.myshopify.com";

/**
 * cp-merchant-directory + cp-merchant-actions: the detail view renders replica
 * shop data with an "as of" timestamp, and the add-note action is guarded by a
 * type-to-confirm input — the submit stays disabled until the operator types the
 * exact shop domain.
 */
test.beforeEach(async ({ page }) => {
  await page.goto(`/dev-login?role=ADMIN&to=/merchants/${SHOP}`);
});

test("detail view shows shop info and an as-of timestamp", async ({ page }) => {
  const detail = page.getByRole("main", { name: `Merchant ${SHOP}` });
  await expect(detail).toBeVisible();
  const info = page.getByLabel("Shop information");
  await expect(info).toContainText("Aurora Threads");
  await expect(info).toContainText(SHOP);
  await expect(info).toContainText("Pro"); // plan from the replica fixture
  // Replica reads are surfaced with an "as of" timestamp.
  await expect(detail).toContainText("as of");
  // Read-only deep link into the merchant's Shopify admin.
  await expect(
    page.getByRole("link", { name: "Open in Shopify admin (new tab)" }),
  ).toBeVisible();
});

test("add-note is gated by a type-to-confirm guard", async ({ page }) => {
  const form = page.getByRole("form", { name: "Add note" });
  const submit = form.getByRole("button", { name: "Add note" });

  await form.getByLabel("Note body").fill("Reached out about renewal.");
  // Without the confirmation, the action cannot run.
  await expect(submit).toBeDisabled();

  // Wrong confirmation text keeps it disabled.
  await form.getByLabel("Type the shop domain to confirm").fill("not-the-shop");
  await expect(submit).toBeDisabled();

  // Typing the exact shop domain enables the guarded action.
  await form.getByLabel("Type the shop domain to confirm").fill(SHOP);
  await expect(submit).toBeEnabled();
});
