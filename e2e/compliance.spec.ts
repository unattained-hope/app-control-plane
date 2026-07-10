import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

/**
 * cp-compliance-dsr: the GDPR/DSR queue is ADMIN-only (compliance:manage, enforced
 * server-side in tRPC). A VIEWER sees no nav link and gets a load error on direct
 * navigation; an ADMIN sees the queue with a live countdown to the 30-day `dueAt`.
 *
 * Self-seeds a near-due request directly in the control-plane DB (the dev server
 * reads the same Postgres), then cleans it up.
 */
const SHOP = "e2e-compliance.myshopify.com";
const DAY_MS = 24 * 60 * 60 * 1000;

function dbUrl(): string {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const m = env.match(/^CONTROL_PLANE_DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("CONTROL_PLANE_DATABASE_URL not found in .env");
  return m[1]!.trim().replace(/^["']|["']$/g, "");
}

let prisma: PrismaClient;

test.beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: dbUrl() });
  const now = Date.now();
  await prisma.complianceRequest.deleteMany({ where: { shop: SHOP } });
  await prisma.complianceRequest.create({
    data: {
      appKey: "saleswitch",
      topic: "CUSTOMERS_REDACT",
      shop: SHOP,
      status: "RECEIVED",
      payload: {},
      receivedAt: new Date(now - 28 * DAY_MS),
      dueAt: new Date(now + 2 * DAY_MS), // near-due → countdown shows "2d left"
    },
  });
});

test.afterAll(async () => {
  await prisma.complianceRequest.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

test("VIEWER has no compliance nav link and is denied the queue", async ({ page }) => {
  await page.goto("/dev-login?role=VIEWER&to=/");
  await expect(page.getByRole("link", { name: "Compliance" })).toHaveCount(0);

  await page.goto("/dev-login?role=VIEWER&to=/compliance");
  await expect(page.getByRole("alert", { name: "Compliance load error" })).toBeVisible();
});

test("ADMIN sees the queue with a countdown for a near-due request", async ({ page }) => {
  await page.goto("/dev-login?role=ADMIN&to=/compliance");
  await expect(page.getByRole("link", { name: "Compliance" })).toBeVisible();

  const table = page.getByRole("table", { name: "Compliance requests" });
  await expect(table).toBeVisible();
  await expect(table.getByText(SHOP)).toBeVisible();
  // The SLA column renders a relative countdown badge for the near-due request.
  await expect(table.getByText(/left|Due today|Overdue/).first()).toBeVisible();
});
