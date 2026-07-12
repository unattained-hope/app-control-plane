import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stubValidEnv } from "./helpers/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");

beforeAll(() => {
  stubValidEnv();
});

const { processBadgeGraphicUpload, BADGE_GRAPHIC_TARGET_MAX_BYTES } = await import(
  "~/server/services/badgeGraphicImageProcessor.js"
);

async function edgeTransparentRatioAvif(avif: Buffer): Promise<number> {
  const { data, info } = await sharp(avif).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let transparent = 0;
  let total = 0;
  const check = (x: number, y: number) => {
    total++;
    if (data[(y * width + x) * 4 + 3]! < 128) transparent++;
  };
  for (let x = 0; x < width; x++) {
    check(x, 0);
    check(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    check(0, y);
    check(width - 1, y);
  }
  return transparent / total;
}

describe("processBadgeGraphicUpload", () => {
  it("removes a solid white background, trims, and encodes AVIF", async () => {
    const size = 120;
    const badgeSize = 40;
    const offset = (size - badgeSize) / 2;

    const source = await sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: badgeSize,
              height: badgeSize,
              channels: 4,
              background: { r: 220, g: 40, b: 40, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          left: offset,
          top: offset,
        },
      ])
      .png()
      .toBuffer();

    const { data, mimeType } = await processBadgeGraphicUpload(source);
    expect(mimeType).toBe("image/avif");

    const meta = await sharp(data).metadata();
    expect(meta.format).toBe("heif");
    expect(meta.width).toBeLessThanOrEqual(256);
    expect(meta.height).toBeLessThanOrEqual(256);
    expect(meta.width).toBeGreaterThan(20);
    expect(meta.hasAlpha).toBe(true);
    expect(data.byteLength).toBeLessThanOrEqual(BADGE_GRAPHIC_TARGET_MAX_BYTES);
  });

  it("downscales large uploads to the max dimension", async () => {
    const source = await sharp({
      create: {
        width: 900,
        height: 600,
        channels: 4,
        background: { r: 30, g: 180, b: 90, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const { data } = await processBadgeGraphicUpload(source);
    const meta = await sharp(data).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(256);
    expect(data.byteLength).toBeLessThanOrEqual(BADGE_GRAPHIC_TARGET_MAX_BYTES);
  });

  it("removes a white AI-generated badge backdrop (End of Season style)", async () => {
    const source = await readFile(path.join(fixtures, "end-of-season-white-bg.jpg"));
    const { data, mimeType } = await processBadgeGraphicUpload(source);
    expect(mimeType).toBe("image/avif");
    expect(data.byteLength).toBeLessThanOrEqual(BADGE_GRAPHIC_TARGET_MAX_BYTES);
    const edge = await edgeTransparentRatioAvif(data);
    expect(edge).toBeGreaterThan(0.65);
    const meta = await sharp(data).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBeGreaterThan(100);
  });

  it("removes a black studio backdrop (Free Shipping style)", async () => {
    const source = await readFile(path.join(fixtures, "free-shipping-black-bg.jpg"));
    const { data } = await processBadgeGraphicUpload(source);
    const meta = await sharp(data).metadata();
    expect(meta.hasAlpha).toBe(true);
    const edge = await edgeTransparentRatioAvif(data);
    expect(edge).toBeGreaterThan(0.3);
  });

  it(
    "accepts large source files that exceed the stored output size cap pre-resize",
    async () => {
      const source = await readFile(path.join(fixtures, "end-of-season-white-bg.jpg"));
      const huge = await sharp(source).resize(4000, 2130).png().toBuffer();
      expect(huge.byteLength).toBeGreaterThan(2_097_152);

      const { data } = await processBadgeGraphicUpload(huge);
      expect(data.byteLength).toBeLessThanOrEqual(BADGE_GRAPHIC_TARGET_MAX_BYTES);
    },
    20_000,
  );
});
