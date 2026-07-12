import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

/**
 * cp-inbox-sla + cp-canned-replies (Tier 1): the agent inbox surfaces a conversation's
 * priority + an SLA countdown chip, renders internal notes distinctly, supports
 * merchant replies over Socket.IO, and inserts canned replies into the composer.
 *
 * Self-seeds a prioritized conversation + messages + a canned reply directly in the
 * control-plane DB (the dev server reads the same Postgres), then cleans up.
 */
const SHOP = "e2e-inbox.myshopify.com";
const CANNED_SHORTCUT = "/e2e-welcome";
const MIN_MS = 60 * 1000;

function dbUrl(): string {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const m = env.match(/^CONTROL_PLANE_DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("CONTROL_PLANE_DATABASE_URL not found in .env");
  return m[1]!.trim().replace(/^["']|["']$/g, "");
}

let prisma: PrismaClient;
let conversationId: string;
let cannedReplyId: string;

test.beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: dbUrl() });
  const now = Date.now();
  await prisma.conversation.deleteMany({ where: { shop: SHOP } });
  await prisma.cannedReply.deleteMany({ where: { appKey: "saleswitch", shortcut: CANNED_SHORTCUT } });

  const canned = await prisma.cannedReply.create({
    data: {
      appKey: "saleswitch",
      shortcut: CANNED_SHORTCUT,
      title: "E2E welcome",
      body: "Hello from {{shop}} — an agent will help you shortly.",
      createdBy: "e2e-admin",
    },
  });
  cannedReplyId = canned.id;

  const convo = await prisma.conversation.create({
    data: {
      appKey: "saleswitch",
      shop: SHOP,
      status: "OPEN",
      priority: "HIGH",
      slaState: "ON_TRACK",
      firstResponseDueAt: new Date(now + 20 * MIN_MS),
      resolutionDueAt: new Date(now + 60 * MIN_MS),
      lastMessageAt: new Date(now),
    },
  });
  conversationId = convo.id;

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
  await prisma.cannedReply.deleteMany({ where: { id: cannedReplyId } });
  await prisma.$disconnect();
});

test("inbox shows a priority + SLA countdown chip and renders the internal note distinctly", async ({
  page,
}) => {
  await page.goto("/dev-login?role=ADMIN&to=/inbox");

  await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);

  const row = page.getByRole("button", { name: new RegExp(SHOP) });
  await expect(row).toBeVisible();
  await expect(row.getByText("HIGH")).toBeVisible();
  await expect(row.getByText(/due in|overdue/)).toBeVisible();

  await row.click();
  const internalNote = page.getByRole("listitem", { name: "Internal note" });
  await expect(internalNote).toBeVisible();
  await expect(internalNote.getByText(/internal only/)).toBeVisible();
});

test("agent can send a merchant reply from the inbox composer", async ({ page }) => {
  await page.goto("/dev-login?role=ADMIN&to=/inbox");

  await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
  await page.getByRole("button", { name: new RegExp(SHOP) }).click();

  const replyBody = "Thanks for reaching out — we're looking into your checkout issue.";
  const composer = page.getByRole("textbox", { name: "Reply body" });
  await composer.fill(replyBody);
  await page.getByRole("button", { name: "Send reply" }).click();

  const agentMessage = page.getByRole("listitem", { name: "Agent message" }).filter({
    hasText: replyBody,
  });
  await expect(agentMessage).toBeVisible({ timeout: 10_000 });
});

test("canned reply shortcut inserts substituted body into the composer", async ({ page }) => {
  await page.goto("/dev-login?role=ADMIN&to=/inbox");

  await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
  await page.getByRole("button", { name: new RegExp(SHOP) }).click();

  await page.getByRole("button", { name: `Insert canned reply ${CANNED_SHORTCUT}` }).click();

  const composer = page.getByRole("textbox", { name: "Reply body" });
  await expect(composer).toHaveValue(`Hello from ${SHOP} — an agent will help you shortly.`);
});
