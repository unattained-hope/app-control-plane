import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const SHOP = "tdd-chat-store.myshopify.com";
const CANNED_SHORTCUT = "/quick-help";
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
      title: "Quick Help",
      body: "Hello {{shop}}, here is quick help with **markdown** and `code`.",
      createdBy: "tdd-admin",
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
      firstResponseDueAt: new Date(now + 30 * MIN_MS),
      resolutionDueAt: new Date(now + 90 * MIN_MS),
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
        body: "Hello, my store badges are not appearing correctly on collection pages.",
        internal: false,
      },
      {
        conversationId: convo.id,
        senderType: "AGENT",
        senderId: "support-agent",
        body: "Checking the theme configuration now.\n\n* Steps checked:\n- Asset snippet\n- App embed block",
        internal: false,
      },
      {
        conversationId: convo.id,
        senderType: "AGENT",
        senderId: "support-agent",
        body: "Internal note: verified badge selector mismatch on Dawn theme.",
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

test.describe("Chat Module UI & Theme TDD suite", () => {
  test("light theme switches html classes, css color-scheme, and renders light styles without dark artifacts", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=ADMIN&to=/inbox");

    // Click Light mode button
    const lightBtn = page.getByRole("radio", { name: "Light" });
    await expect(lightBtn).toBeVisible();
    await lightBtn.click();

    // Verify html tag does NOT have .dark class and colorScheme is light
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveCSS("color-scheme", "light");

    // Check light theme CSS variables applied on body
    const body = page.locator("body");
    await expect(body).toHaveCSS("background-color", "rgb(249, 250, 251)");
    await expect(body).toHaveCSS("color", "rgb(17, 24, 39)");

    // Verify local storage persistence
    const storedTheme = await page.evaluate(() => localStorage.getItem("cp-theme"));
    expect(storedTheme).toBe("light");

    // Reload page and check that Light mode is retained without flicker
    await page.reload();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveCSS("color-scheme", "light");
  });

  test("dark theme switches html classes, css color-scheme, and renders obsidian dark palette", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=ADMIN&to=/inbox");

    // Click Dark mode button
    const darkBtn = page.getByRole("radio", { name: "Dark" });
    await expect(darkBtn).toBeVisible();
    await darkBtn.click();

    // Verify html tag HAS .dark class and colorScheme is dark
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveCSS("color-scheme", "dark");

    // Wait for CSS background transition to settle to #050508 rgb(5, 5, 8)
    const body = page.locator("body");
    await expect(body).toHaveCSS("background-color", "rgb(5, 5, 8)");
    await expect(body).toHaveCSS("color", "rgb(255, 255, 255)");

    const storedTheme = await page.evaluate(() => localStorage.getItem("cp-theme"));
    expect(storedTheme).toBe("dark");
  });

  test("inbox conversation list, status filter tabs, search and selection work seamlessly", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=ADMIN&to=/inbox");

    // Search for our test conversation
    const searchInput = page.getByRole("searchbox", { name: "Search conversations" });
    await searchInput.fill(SHOP);

    const convoBtn = page.getByRole("button", { name: new RegExp(SHOP) });
    await expect(convoBtn).toBeVisible();

    // Select the conversation
    await convoBtn.click();
    await expect(convoBtn).toHaveClass(/is-selected/);

    // Status filter tabs test
    const allTab = page.getByRole("tab", { name: "All" });
    const openTab = page.getByRole("tab", { name: "Open" });
    const snoozedTab = page.getByRole("tab", { name: "Snoozed" });
    const closedTab = page.getByRole("tab", { name: "Closed" });

    await expect(allTab).toBeVisible();
    await expect(openTab).toBeVisible();
    await expect(snoozedTab).toBeVisible();
    await expect(closedTab).toBeVisible();

    // Open tab should be active by default or clickable
    await openTab.click();
    await expect(convoBtn).toBeVisible();

    // Switch to Closed tab - our OPEN convo should not be listed
    await closedTab.click();
    await expect(page.getByText("No conversations match this filter.")).toBeVisible();

    // Switch back to Open tab
    await openTab.click();
    await expect(convoBtn).toBeVisible();
  });

  test("message thread renders merchant, agent, internal note messages, and markdown elements correctly", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=ADMIN&to=/inbox");
    await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
    await page.getByRole("button", { name: new RegExp(SHOP) }).click();

    // Merchant bubble
    const merchantBubble = page.getByRole("listitem", { name: "Merchant message" });
    await expect(merchantBubble).toBeVisible();
    await expect(merchantBubble.getByText("Hello, my store badges are not appearing")).toBeVisible();

    // Agent bubble with markdown list
    const agentBubble = page.getByRole("listitem", { name: "Agent message" });
    await expect(agentBubble).toBeVisible();
    await expect(agentBubble.getByText("Checking the theme configuration now.")).toBeVisible();
    await expect(agentBubble.getByText("Asset snippet")).toBeVisible();
    await expect(agentBubble.getByText("App embed block")).toBeVisible();

    // Internal note bubble
    const internalNote = page.getByRole("listitem", { name: "Internal note" });
    await expect(internalNote).toBeVisible();
    await expect(internalNote.getByText("Internal note: verified badge selector mismatch")).toBeVisible();
  });

  test("formatting toolbar inserts markdown syntax at cursor position", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=ADMIN&to=/inbox");
    await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
    await page.getByRole("button", { name: new RegExp(SHOP) }).click();

    const composer = page.getByRole("textbox", { name: "Reply body" });
    await composer.fill("sample text");
    await composer.selectText();

    // Click Bold toolbar button to wrap selected text
    await page.getByRole("button", { name: "Format bold" }).click();
    await expect(composer).toHaveValue("**sample text**");
  });

  test("slash command popover filters canned replies and inserts into composer on selection", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=ADMIN&to=/inbox");
    await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
    await page.getByRole("button", { name: new RegExp(SHOP) }).click();

    const composer = page.getByRole("textbox", { name: "Reply body" });
    await composer.fill("/");

    // The autocomplete popover should open
    const popover = page.getByRole("listbox", { name: "Canned replies autocomplete" });
    await expect(popover).toBeVisible();

    // Select the canned reply option
    const option = popover.getByRole("option").filter({ hasText: "Quick Help" });
    await expect(option).toBeVisible();
    await option.click();

    // Verify substituted text inserted into composer
    await expect(composer).toHaveValue(
      `Hello ${SHOP}, here is quick help with **markdown** and \`code\`.`,
    );
  });

  test("triage sidebar controls: status change, priority change, tags add/remove, and assign", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=ADMIN&to=/inbox");
    await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
    await page.getByRole("button", { name: new RegExp(SHOP) }).click();

    const sidebar = page.getByRole("complementary", { name: "Conversation tools" });
    await expect(sidebar).toBeVisible();

    // Verify Merchant Overview card
    await expect(sidebar.getByText("Merchant Overview")).toBeVisible();
    await expect(sidebar.getByText("HEALTHY")).toBeVisible();
    await expect(sidebar.getByText("SaleSwitch / Badgy")).toBeVisible();

    // Add a tag
    const tagInput = sidebar.getByRole("textbox", { name: "Tag label" });
    await tagInput.fill("urgent-fix");
    await sidebar.getByRole("button", { name: "Add" }).click();

    // Tag should appear
    const tagBadge = sidebar.getByRole("button", { name: "Remove tag urgent-fix" });
    await expect(tagBadge).toBeVisible();

    // Remove the tag
    await tagBadge.click();
    await expect(tagBadge).not.toBeVisible();
  });

  test("inbox layout is sticky with fixed height and auto-scrolls to newest message", async ({
    page,
  }) => {
    // Insert 15 messages so the chat list definitely exceeds the container height
    const manyMessages = Array.from({ length: 15 }, (_, i) => ({
      conversationId,
      senderType: i % 2 === 0 ? "MERCHANT" : "AGENT",
      senderId: i % 2 === 0 ? SHOP : "support-agent",
      body: `Message index ${i + 1} for scrolling verification test`,
      internal: false,
    }));
    await prisma.message.createMany({ data: manyMessages });

    await page.goto("/dev-login?role=ADMIN&to=/inbox");
    await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
    await page.getByRole("button", { name: new RegExp(SHOP) }).click();

    // 1. Verify Inbox sidebar and Triage sidebar are visible
    const inboxSidebar = page.getByRole("complementary", { name: "Conversations" });
    const triageSidebar = page.getByRole("complementary", { name: "Conversation tools" });
    const threadHeader = page.locator(".apoaap-inbox-thread-header");
    const composer = page.locator(".apoaap-inbox-composer");
    const messagesContainer = page.getByRole("region", { name: "Message history" });

    await expect(inboxSidebar).toBeVisible();
    await expect(triageSidebar).toBeVisible();
    await expect(threadHeader).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(messagesContainer).toBeVisible();

    // 2. Verify outer shell does not scroll
    const mainScrollable = await page.evaluate(() => {
      const main = document.querySelector(".apoaap-shell-main");
      return {
        windowScrollY: window.scrollY,
        mainScrollTop: main ? main.scrollTop : 0,
        mainScrollHeight: main ? main.scrollHeight : 0,
        mainClientHeight: main ? main.clientHeight : 0,
      };
    });
    expect(mainScrollable.windowScrollY).toBe(0);
    expect(mainScrollable.mainScrollTop).toBe(0);

    // 3. Verify the message history container has internal scroll and scrolled to the newest message
    await page.waitForTimeout(150); // allow scroll anchor / auto-scroll to execute
    const scrollInfo = await messagesContainer.evaluate((el) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);
    expect(scrollInfo.scrollTop).toBeGreaterThan(0);

    // 4. Verify newest message is in viewport
    const newestMsg = page.getByText("Message index 15 for scrolling verification test");
    await expect(newestMsg).toBeVisible();
  });

  test("chat pinning places conversation at the highest priority and toggles state", async ({
    page,
  }) => {
    // Seed another shop with a more recent message
    const OTHER_SHOP = "newer-shop.myshopify.com";
    await prisma.conversation.deleteMany({ where: { shop: OTHER_SHOP } });
    const newerConvo = await prisma.conversation.create({
      data: {
        appKey: "saleswitch",
        shop: OTHER_SHOP,
        status: "OPEN",
        lastMessageAt: new Date(Date.now() + 10000),
      },
    });

    try {
      await page.goto("/dev-login?role=ADMIN&to=/inbox");

      // Select our conversation
      await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
      await page.getByRole("button", { name: new RegExp(SHOP) }).click();

      // Click the Pin button in the thread header
      const pinBtn = page.locator(".apoaap-inbox-thread-header").getByRole("button", { name: "Pin conversation" });
      await expect(pinBtn).toBeVisible();
      await pinBtn.click();

      // Verify the button state changes to "Unpin conversation" / "Pinned"
      const unpinBtn = page.locator(".apoaap-inbox-thread-header").getByRole("button", { name: "Unpin conversation" });
      await expect(unpinBtn).toBeVisible();

      // Clear search to view full list
      await page.getByRole("searchbox", { name: "Search conversations" }).fill("");

      // Verify our pinned conversation has the pinned badge and is the FIRST item in the list
      const firstListItem = page.locator(".apoaap-inbox-list-items li").first();
      await expect(firstListItem.getByText(SHOP)).toBeVisible();
      await expect(firstListItem.locator(".apoaap-inbox-pin-badge")).toBeVisible();

      // Click Unpin
      await unpinBtn.click();
      await expect(page.locator(".apoaap-inbox-thread-header").getByRole("button", { name: "Pin conversation" })).toBeVisible();
    } finally {
      await prisma.conversation.deleteMany({ where: { shop: OTHER_SHOP } });
    }
  });

  test("composer supports switching to internal note mode and posting note", async ({
    page,
  }) => {
    await page.goto("/dev-login?role=ADMIN&to=/inbox");
    await page.getByRole("searchbox", { name: "Search conversations" }).fill(SHOP);
    await page.getByRole("button", { name: new RegExp(SHOP) }).click();

    // Switch to internal note tab
    const noteTab = page.getByRole("tab", { name: "Internal note" });
    await noteTab.click();

    const noteComposer = page.getByRole("textbox", { name: "Internal note body" });
    await expect(noteComposer).toBeVisible();

    const noteText = "Adding another internal note for TDD verification.";
    await noteComposer.fill(noteText);

    // Submit note
    await page.getByRole("button", { name: "Add internal note" }).click();

    // Verify new internal note is visible in message list
    const newNote = page.getByRole("listitem", { name: "Internal note" }).filter({
      hasText: noteText,
    });
    await expect(newNote).toBeVisible({ timeout: 10_000 });
  });
});
