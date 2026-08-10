import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface BundledBadgeGraphic {
  readonly id: string;
  readonly label: string;
  readonly textBaked: boolean;
  readonly theme: string;
  readonly graphicType: string;
}

function isBundledBadgeGraphic(value: unknown): value is BundledBadgeGraphic {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.label === "string" &&
    typeof row.textBaked === "boolean" &&
    typeof row.theme === "string" &&
    typeof row.graphicType === "string"
  );
}

describe("bundled badge catalog", () => {
  it("ships one decodable asset file for every metadata row", async () => {
    const assetDir = path.resolve("assets/badge-graphics");
    const parsed: unknown = JSON.parse(
      await readFile(path.join(assetDir, "catalog.json"), "utf8"),
    );
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;

    const rows = parsed.filter(isBundledBadgeGraphic);
    expect(rows).toHaveLength(parsed.length);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);

    await Promise.all(
      rows.map(async (row) => {
        const asset = await readFile(path.join(assetDir, `${row.id}.avif`));
        expect(asset.length).toBeGreaterThan(12);
        expect(asset.subarray(4, 12).toString("ascii")).toBe("ftypavif");
      }),
    );
  });
});
