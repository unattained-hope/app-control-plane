#!/usr/bin/env node
/**
 * One-time dev import: reads Badgy's generated `badgeGraphicCatalog.ts` and seeds
 * the control-plane `badge_graphics` table + copies AVIF assets into local storage.
 *
 * Usage (from app-control-plane root):
 *   node scripts/import-badgy-badge-catalog.mjs
 *
 * Requires: sibling `../badgy` repo with `shared/badgeGraphicCatalog.ts` and
 * `public/images/badge-graphics/*.avif`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CP_ROOT = path.join(__dirname, "..");
const BADGY_ROOT = path.join(CP_ROOT, "..", "badgy");
const CATALOG_PATH = path.join(BADGY_ROOT, "shared", "badgeGraphicCatalog.ts");
const BADGY_ASSETS = path.join(BADGY_ROOT, "public", "images", "badge-graphics");
const STORAGE_DIR = path.join(CP_ROOT, "data", "badge-graphics", "saleswitch");

const APP_KEY = "saleswitch";

/** Parse `BADGE_GRAPHIC_IMAGES` array literals from the generated TS catalog. */
async function loadCatalogEntries() {
  const src = await fs.readFile(CATALOG_PATH, "utf8");
  const match = src.match(
    /export const BADGE_GRAPHIC_IMAGES[^=]*=\s*(\[[\s\S]*?\]);/,
  );
  if (!match) {
    throw new Error(`Could not parse catalog from ${CATALOG_PATH}`);
  }
  const normalized = match[1]
    .replace(/BadgeGraphicTheme\.(\w+)/g, '"$1"')
    .replace(/BadgeGraphicType\.(\w+)/g, '"$1"');
  // eslint-disable-next-line no-eval
  const entries = eval(normalized);
  if (!Array.isArray(entries)) {
    throw new Error("Catalog parse did not yield an array");
  }
  return entries;
}

async function main() {
  const entries = await loadCatalogEntries();
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  const prisma = new PrismaClient();
  let imported = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const filename = `${entry.id}.avif`;
    const srcFile = path.join(BADGY_ASSETS, filename);
    const destFile = path.join(STORAGE_DIR, filename);

    try {
      await fs.copyFile(srcFile, destFile);
    } catch {
      console.warn(`Skipping missing asset: ${filename}`);
      continue;
    }

    const imagePath = `/api/badge-graphics/assets/${APP_KEY}/${filename}`;
    await prisma.badgeGraphic.upsert({
      where: { appKey_slug: { appKey: APP_KEY, slug: entry.id } },
      create: {
        appKey: APP_KEY,
        slug: entry.id,
        label: entry.label,
        imagePath,
        textBaked: entry.textBaked,
        theme: entry.theme,
        graphicType: entry.graphicType,
        sortOrder: i,
        status: "ACTIVE",
      },
      update: {
        label: entry.label,
        imagePath,
        textBaked: entry.textBaked,
        theme: entry.theme,
        graphicType: entry.graphicType,
        sortOrder: i,
        status: "ACTIVE",
      },
    });
    imported += 1;
  }

  await prisma.$disconnect();
  console.log(`Imported ${imported} badge graphics into control-plane for ${APP_KEY}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
