#!/usr/bin/env node
/**
 * Vendor Badgy's generated badge catalog and AVIF assets into this standalone
 * control-plane repository. Run deliberately when the canonical Badgy catalog
 * changes; production deployment consumes only the checked-in bundle.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const controlPlaneRoot = path.resolve(scriptDir, "..");
const badgyRoot = path.resolve(controlPlaneRoot, "..", "badgy");
const catalogPath = path.join(badgyRoot, "shared", "badgeGraphicCatalog.ts");
const sourceAssets = path.join(badgyRoot, "public", "images", "badge-graphics");
const bundledAssets = path.join(controlPlaneRoot, "assets", "badge-graphics");

async function loadCatalogEntries() {
  const source = await fs.readFile(catalogPath, "utf8");
  const match = source.match(
    /export const BADGE_GRAPHIC_IMAGES[^=]*=\s*(\[[\s\S]*?\]);/,
  );
  if (!match) throw new Error(`Could not parse catalog from ${catalogPath}`);

  const normalized = match[1]
    .replace(/BadgeGraphicTheme\.(\w+)/g, '"$1"')
    .replace(/BadgeGraphicType\.(\w+)/g, '"$1"');
  // Generated, repository-owned TypeScript array literals only.
  // eslint-disable-next-line no-eval
  const entries = eval(normalized);
  if (!Array.isArray(entries)) throw new Error("Catalog parse did not yield an array");
  return entries;
}

async function main() {
  const entries = await loadCatalogEntries();
  await fs.mkdir(bundledAssets, { recursive: true });

  const expectedFiles = new Set(["catalog.json"]);
  for (const entry of entries) {
    const filename = `${entry.id}.avif`;
    expectedFiles.add(filename);
    await fs.copyFile(path.join(sourceAssets, filename), path.join(bundledAssets, filename));
  }

  for (const filename of await fs.readdir(bundledAssets)) {
    if (filename.endsWith(".avif") && !expectedFiles.has(filename)) {
      await fs.unlink(path.join(bundledAssets, filename));
    }
  }

  const metadata = entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    textBaked: entry.textBaked,
    theme: entry.theme,
    graphicType: entry.graphicType,
  }));
  await fs.writeFile(
    path.join(bundledAssets, "catalog.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  console.log(`Vendored ${entries.length} badge graphics from Badgy`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
