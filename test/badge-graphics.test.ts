import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => {
  stubValidEnv();
  process.env.BADGE_GRAPHIC_READ_TOKEN = "badge-secret";
});

const { BadgeGraphicService, BadgeGraphicSlugConflictError } = await import(
  "~/server/services/badgeGraphicService.js"
);
const { getAuditService } = await import("~/server/services/auditService.js");
const badgeGraphicsRoute = await import("~/routes/api.badge-graphics.js");

const actor = { id: "admin1", email: "admin@apoaap.io", ip: null, userAgent: null };

function makeSvc(db: FakeDb) {
  return new BadgeGraphicService(db as never, getAuditService());
}

const sampleInput = {
  slug: "minimal-sale",
  label: "Sale",
  imagePath: "/api/badge-graphics/assets/saleswitch/minimal-sale.avif",
  textBaked: true,
  theme: "MINIMAL",
  graphicType: "OFFER",
  sortOrder: 0,
};

/** cp-app-settings — badge graphic gallery CRUD + read API. */
describe("BadgeGraphicService", () => {
  it("creates a graphic and audits badge.graphic.create", async () => {
    const db = new FakeDb();
    const row = await makeSvc(db).create(actor, "saleswitch", sampleInput);
    expect(row.slug).toBe("minimal-sale");
    expect(db.store.badgeGraphic).toHaveLength(1);
    expect(db.store.auditLog.some((a) => a.action === "badge.graphic.create")).toBe(true);
  });

  it("rejects duplicate slugs for the same app", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.create(actor, "saleswitch", sampleInput);
    await expect(svc.create(actor, "saleswitch", sampleInput)).rejects.toBeInstanceOf(
      BadgeGraphicSlugConflictError,
    );
  });

  it("updates a graphic and audits badge.graphic.update", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const created = await svc.create(actor, "saleswitch", sampleInput);
    const updated = await svc.update(actor, "saleswitch", created.id, { label: "Mega Sale" });
    expect(updated.label).toBe("Mega Sale");
    expect(updated.imagePath).toMatch(/\?v=\d+$/);
    expect(db.store.auditLog.some((a) => a.action === "badge.graphic.update")).toBe(true);
  });

  it("bumps the cache-bust token when the image path is replaced at the same URL", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const created = await svc.create(actor, "saleswitch", sampleInput);
    const firstVersion = created.imagePath;
    await new Promise((r) => setTimeout(r, 5));
    const replaced = await svc.update(actor, "saleswitch", created.id, {
      imagePath: sampleInput.imagePath,
    });
    expect(replaced.imagePath).toMatch(/\?v=\d+$/);
    expect(replaced.imagePath).not.toBe(firstVersion);
  });

  it("archives a graphic (soft delete) and audits badge.graphic.archive", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const created = await svc.create(actor, "saleswitch", sampleInput);
    await svc.archive(actor, "saleswitch", created.id);
    const active = await svc.list("saleswitch");
    expect(active).toHaveLength(0);
    const all = await svc.list("saleswitch", { includeArchived: true });
    expect(all[0]?.status).toBe("ARCHIVED");
    expect(db.store.auditLog.some((a) => a.action === "badge.graphic.archive")).toBe(true);
  });

  it("filters by theme and graphic type", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.create(actor, "saleswitch", sampleInput);
    await svc.create(actor, "saleswitch", {
      ...sampleInput,
      slug: "retro-sale",
      theme: "RETRO",
    });
    const retro = await svc.list("saleswitch", { theme: "RETRO" });
    expect(retro).toHaveLength(1);
    expect(retro[0]?.slug).toBe("retro-sale");
  });

  it("permanently deletes a graphic and audits badge.graphic.delete", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const created = await svc.create(actor, "saleswitch", sampleInput);
    await svc.remove(actor, "saleswitch", created.id);
    expect(db.store.badgeGraphic).toHaveLength(0);
    expect(db.store.auditLog.some((a) => a.action === "badge.graphic.delete")).toBe(true);
  });

  it("resolves and sets the default image badge slug", async () => {
    const db = new FakeDb();
    await db.app.create({
      data: { key: "saleswitch", name: "SaleSwitch", defaultBadgeGraphicSlug: null },
    });
    const svc = makeSvc(db);
    await svc.create(actor, "saleswitch", sampleInput);
    const retro = await svc.create(actor, "saleswitch", {
      ...sampleInput,
      slug: "retro-sale",
      theme: "RETRO",
    });
    expect(await svc.getDefaultSlug("saleswitch")).toBe("retro-sale");

    await svc.setDefaultSlug(actor, "saleswitch", "minimal-sale");
    expect(await svc.getDefaultSlug("saleswitch")).toBe("minimal-sale");
    expect(db.store.auditLog.some((a) => a.action === "badge.graphic.setDefault")).toBe(true);

    await svc.archive(actor, "saleswitch", retro.id);
    expect(await svc.getDefaultSlug("saleswitch")).toBe("minimal-sale");
  });

  it("returns the active default graphic row for admin preview", async () => {
    const db = new FakeDb();
    await db.app.create({
      data: { key: "saleswitch", name: "SaleSwitch", defaultBadgeGraphicSlug: null },
    });
    const svc = makeSvc(db);
    await svc.create(actor, "saleswitch", sampleInput);
    await svc.create(actor, "saleswitch", {
      ...sampleInput,
      slug: "retro-sale",
      theme: "RETRO",
    });
    await svc.setDefaultSlug(actor, "saleswitch", "minimal-sale");
    const graphic = await svc.getDefaultGraphic("saleswitch");
    expect(graphic?.slug).toBe("minimal-sale");
    expect(graphic?.imagePath).toMatch(/minimal-sale\.avif\?v=\d+$/);
  });
});

describe("/api/badge-graphics read endpoint", () => {
  it("rejects a missing bearer token", async () => {
    const res = await badgeGraphicsRoute.loader({
      request: new Request("https://cp.test/api/badge-graphics?app=saleswitch"),
    } as never);
    expect((res as Response).status).toBe(401);
  });

  it("rejects a wrong bearer token", async () => {
    const res = await badgeGraphicsRoute.loader({
      request: new Request("https://cp.test/api/badge-graphics?app=saleswitch", {
        headers: { authorization: "Bearer nope" },
      }),
    } as never);
    expect((res as Response).status).toBe(401);
  });
});
