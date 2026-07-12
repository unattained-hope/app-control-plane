import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

beforeAll(() => {
  stubValidEnv();
});

const { publicBadgeGraphicAssetUrl, stripBadgeGraphicAssetQuery, withBadgeGraphicCacheBust } =
  await import("~/lib/badgeGraphicUrls.js");
const { loadConfig } = await import("~/lib/config.js");

describe("badge graphic asset URLs", () => {
  it("strips cache-bust query strings from stored paths", () => {
    expect(stripBadgeGraphicAssetQuery("/api/badge-graphics/assets/saleswitch/x.avif?v=123")).toBe(
      "/api/badge-graphics/assets/saleswitch/x.avif",
    );
  });

  it("appends updatedAt as a cache-bust query param", () => {
    expect(withBadgeGraphicCacheBust("/api/badge-graphics/assets/saleswitch/x.avif", 123456)).toBe(
      "/api/badge-graphics/assets/saleswitch/x.avif?v=123456",
    );
  });
});

describe("publicBadgeGraphicAssetUrl", () => {
  it("returns relative paths when no public base is set", () => {
    const cfg = loadConfig({
      ...process.env,
      BADGE_GRAPHIC_PUBLIC_BASE_URL: "",
    } as NodeJS.ProcessEnv);
    expect(publicBadgeGraphicAssetUrl("/api/badge-graphics/assets/saleswitch/x.avif", cfg)).toBe(
      "/api/badge-graphics/assets/saleswitch/x.avif",
    );
  });

  it("prefixes absolute URLs when public base is set", () => {
    const cfg = loadConfig({
      ...process.env,
      BADGE_GRAPHIC_PUBLIC_BASE_URL: "https://cp.example.com",
    } as NodeJS.ProcessEnv);
    expect(publicBadgeGraphicAssetUrl("/api/badge-graphics/assets/saleswitch/x.avif", cfg)).toBe(
      "https://cp.example.com/api/badge-graphics/assets/saleswitch/x.avif",
    );
  });
});

describe("badgeGraphicStorage fallback", () => {
  it("serves from fallback dir when primary storage is empty", async () => {
    const tmp = await mkdir(path.join(os.tmpdir(), `cp-badge-${Date.now()}`), {
      recursive: true,
    }).then((d) => d ?? path.join(os.tmpdir(), `cp-badge-${Date.now()}`));

    const storageDir = path.join(tmp, "storage");
    const fallbackDir = path.join(tmp, "fallback");
    await mkdir(fallbackDir, { recursive: true });
    await writeFile(path.join(fallbackDir, "test.avif"), "fake-avif");

    process.env.BADGE_GRAPHIC_STORAGE_DIR = storageDir;
    process.env.BADGE_GRAPHIC_FALLBACK_DIR = fallbackDir;

    const { loadConfig } = await import("~/lib/config.js");
    loadConfig(process.env);

    const { readBadgeGraphicFile } = await import(
      "~/server/services/badgeGraphicStorage.js"
    );
    const { data, mimeType, etag } = await readBadgeGraphicFile("saleswitch", "test.avif");
    expect(data.toString()).toBe("fake-avif");
    expect(mimeType).toBe("image/avif");
    expect(etag.startsWith('"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);

    await rm(tmp, { recursive: true, force: true });
  });
});
