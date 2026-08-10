#!/usr/bin/env node
/**
 * Idempotently imports the checked-in Badgy badge bundle into the control-plane
 * database and configured persistent asset storage.
 *
 * Usage (from app-control-plane root):
 *   node scripts/import-badgy-badge-catalog.mjs
 *
 * Production deployment runs this inside the schema image with the
 * `badge_graphics` volume mounted at BADGE_GRAPHIC_STORAGE_DIR.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CP_ROOT = path.join(__dirname, "..");
const BUNDLED_ASSETS = path.join(CP_ROOT, "assets", "badge-graphics");
const CATALOG_PATH = path.join(BUNDLED_ASSETS, "catalog.json");
const STORAGE_ROOT = process.env.BADGE_GRAPHIC_STORAGE_DIR
  ? path.resolve(process.env.BADGE_GRAPHIC_STORAGE_DIR)
  : path.join(CP_ROOT, "data", "badge-graphics");

const APP_KEY = "saleswitch";

async function loadCatalogEntries() {
  const entries = JSON.parse(await fs.readFile(CATALOG_PATH, "utf8"));
  if (!Array.isArray(entries)) {
    throw new Error("Catalog parse did not yield an array");
  }
  return entries;
}

async function main() {
  const entries = await loadCatalogEntries();
  const storageDir = path.join(STORAGE_ROOT, APP_KEY);
  await fs.mkdir(storageDir, { recursive: true });

  const prisma = new PrismaClient();
  let imported = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const filename = `${entry.id}.avif`;
    const srcFile = path.join(BUNDLED_ASSETS, filename);
    const destFile = path.join(storageDir, filename);
    await fs.copyFile(srcFile, destFile);

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

  // This seed-only placeholder never had a corresponding asset. Archive the
  // stale metadata without touching merchant-uploaded graphics.
  await prisma.badgeGraphic.updateMany({
    where: { appKey: APP_KEY, slug: "minimal-blank-circle" },
    data: { status: "ARCHIVED" },
  });

  await prisma.$disconnect();
  console.log(
    `Imported ${imported} bundled badge graphics into ${storageDir} for ${APP_KEY}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
