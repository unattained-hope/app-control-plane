import { getConfig } from "./config.js";

/** Strip cache-bust query strings before resolving a stored asset path. */
export function stripBadgeGraphicAssetQuery(imagePath: string): string {
  const q = imagePath.indexOf("?");
  return q === -1 ? imagePath : imagePath.slice(0, q);
}

/** Append a stable cache-bust token derived from row `updatedAt`. */
export function withBadgeGraphicCacheBust(imagePath: string, version: number): string {
  const base = stripBadgeGraphicAssetQuery(imagePath);
  return `${base}?v=${version}`;
}

/**
 * Resolve a badge graphic asset path for cross-origin consumers (Badgy on another host).
 * Admin UI uses same-origin relative paths; the merchant read API may prefix a public base.
 */
export function publicBadgeGraphicAssetUrl(
  imagePath: string,
  cfg = getConfig(),
): string {
  const base = cfg.BADGE_GRAPHIC_PUBLIC_BASE_URL.trim().replace(/\/$/, "");
  if (!base) return imagePath;
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }
  return `${base}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`;
}
