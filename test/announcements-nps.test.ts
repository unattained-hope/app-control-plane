import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { AnnouncementService } = await import("~/server/services/announcementService.js");
const { NpsService, InvalidNpsScoreError } = await import("~/server/services/npsService.js");
const { ConversationService } = await import("~/server/services/conversationService.js");
const { getAuditService } = await import("~/server/services/auditService.js");

const NOW = new Date("2026-06-28T12:00:00.000Z");
const actor = { id: "admin1", email: "admin@apoaap.io", ip: null, userAgent: null };

/** cp-announcements-nps — broadcast over the gateway + persist a SYSTEM message; NPS via the widget. */
describe("AnnouncementService", () => {
  it("publishes, broadcasts, persists a SYSTEM message, and audits", async () => {
    const db = new FakeDb();
    const emitted: unknown[] = [];
    const svc = new AnnouncementService(
      db as never,
      getAuditService(),
      new ConversationService(db as never),
      () => ({ emit: (_e, p) => emitted.push(p) }),
    );

    await svc.publish(
      actor,
      "saleswitch",
      { title: "New feature", body: "Try it", audience: "SHOP_LIST", audienceValue: "aurora.myshopify.com" },
      NOW,
    );

    expect(db.store.announcement).toHaveLength(1);
    expect(db.store.auditLog.some((a) => a.action === "announcement.publish")).toBe(true);
    expect(emitted).toHaveLength(1);
    // A SYSTEM message landed in the targeted shop's conversation.
    const sys = db.store.message.find((m) => m.senderType === "SYSTEM");
    expect(sys).toBeTruthy();
    expect(String(sys!.body)).toContain("New feature");
  });

  it("excludes expired announcements from the active list", async () => {
    const db = new FakeDb();
    db.store.announcement.push(
      { id: "a1", appKey: "saleswitch", title: "live", body: "b", audience: "ALL", publishedAt: NOW, expiresAt: null },
      {
        id: "a2",
        appKey: "saleswitch",
        title: "old",
        body: "b",
        audience: "ALL",
        publishedAt: new Date(NOW.getTime() - 1000),
        expiresAt: new Date(NOW.getTime() - 500),
      },
    );
    const svc = new AnnouncementService(db as never, getAuditService(), new ConversationService(db as never), () => null);
    const active = await svc.listActive("saleswitch", NOW);
    expect(active.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("NpsService", () => {
  function makeSvc(db: FakeDb) {
    return new NpsService(db as never, getAuditService());
  }

  it("records a valid score once per window (idempotent) and audits", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const first = await svc.record("saleswitch", "aurora.myshopify.com", null, 9, null, NOW);
    expect(first.recorded).toBe(true);
    expect(db.store.auditLog.some((a) => a.action === "nps.recorded")).toBe(true);

    const second = await svc.record("saleswitch", "aurora.myshopify.com", null, 4, null, NOW);
    expect(second.recorded).toBe(false); // within the survey window
    expect(db.store.npsResponse).toHaveLength(1);
  });

  it("rejects an out-of-range score", async () => {
    const db = new FakeDb();
    await expect(
      makeSvc(db).record("saleswitch", "x.myshopify.com", null, 11, null, NOW),
    ).rejects.toBeInstanceOf(InvalidNpsScoreError);
  });

  it("computes NPS as %promoters − %detractors", async () => {
    const db = new FakeDb();
    db.store.npsResponse.push(
      { id: "n1", appKey: "saleswitch", shop: "a", score: 9 },
      { id: "n2", appKey: "saleswitch", shop: "b", score: 10 },
      { id: "n3", appKey: "saleswitch", shop: "c", score: 3 },
    );
    expect(await makeSvc(db).computeNps("saleswitch")).toBe(33); // (2 − 1)/3 * 100
  });
});
