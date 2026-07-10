import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

/**
 * cp-inbox-sla + cp-canned-replies (Tier 1): the agent inbox surfaces a conversation's
 * priority + an SLA countdown chip, and renders internal notes distinctly (they are
 * filtered from the merchant stream server-side — unit-tested separately).
 *
 * Self-seeds a prioritized conversation + a public message + an internal note directly
 * in the control-plane DB (the dev server reads the same Postgres), then cleans up.
 */
const SHOP = "e2e-inbox.myshopify.com";
const MIN_MS = 60 * 1000;

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
  await prisma.conversation.deleteMany({ where: { shop: SHOP } });
  const convo = await prisma.conversation.create({
    data: {
      appKey: "saleswitch",
      shop: SHOP,
      status: "OPEN",
      priority: "HIGH",
      slaState: "ON_TRACK",
      firstResponseDueAt: new Date(now + 20 * MIN_MS), // near-due → "due in 20m"
      resolutionDueAt: new Date(now + 60 * MIN_MS),
      lastMessageAt: new Date(now),
    },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: convo.id,
        senderType: "MERCHANT",
        senderId: SHOP,
        body: "My checkout button is broken",
        internal: false,
      },
      {
        conversationId: convo.id,
        senderType: "AGENT",
        senderId: "agent-e2e",
        body: "Escalating to engineering — internal only",
        internal: true,
      },
    ],
  });
});

test.afterAll(async () => {
  await prisma.conversation.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

test("inbox shows a priority + SLA countdown chip and renders the internal note distinctly", async ({
  page,
}) => {
  await page.goto("/dev-login?role=ADMIN&to=/inbox");

  // Search narrows to the seeded conversation.
  await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);

  const row = page.getByRole("button", { name: new RegExp(SHOP) });
  await expect(row).toBeVisible();
  await expect(row.getByText("HIGH")).toBeVisible();
  await expect(row.getByText(/due in|overdue/)).toBeVisible();

  // Open the conversation: the internal note is shown to the agent, labeled distinctly.
  await row.click();
  const internalNote = page.getByRole("listitem", { name: "Internal note" });
  await expect(internalNote).toBeVisible();
  await expect(internalNote.getByText(/internal only/)).toBeVisible();
});
