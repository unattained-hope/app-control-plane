import { mkdir, writeFile, readFile, access, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "~/lib/config.js";
import { stripBadgeGraphicAssetQuery } from "~/lib/badgeGraphicUrls.js";
import { processBadgeGraphicUpload } from "./badgeGraphicImageProcessor.js";

/** Raw uploads may be large before resize/AVIF; processed output must fit BADGE_GRAPHIC_MAX_BYTES. */
const BADGE_GRAPHIC_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Input formats accepted before server-side normalization to AVIF. */
const ALLOWED_UPLOAD_MIME = new Set([
  "image/avif",
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/svg+xml",
]);

function mimeFromExt(ext: string): string {
  switch (ext) {
    case ".avif":
      return "image/avif";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function resolveStoragePath(storageDir: string, appKey: string, filename: string): string {
  const safeName = path.basename(filename);
  const filePath = path.join(storageDir, appKey, safeName);
  const resolved = path.resolve(filePath);
  const base = path.resolve(path.join(storageDir, appKey));
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error("Invalid asset path");
  }
  return resolved;
}

function resolveFallbackPath(fallbackDir: string, filename: string): string {
  const safeName = path.basename(filename);
  const filePath = path.join(fallbackDir, safeName);
  const resolved = path.resolve(filePath);
  const base = path.resolve(fallbackDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error("Invalid fallback asset path");
  }
  return resolved;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveOutputFilename(filename: string, slug?: string): string {
  if (slug) {
    const safeSlug = slug.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!safeSlug) throw new Error("Invalid slug for output filename");
    return `${safeSlug}.avif`;
  }
  const base = path.basename(filename).replace(/\.[^.]+$/, "");
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safeBase) throw new Error("Invalid filename");
  return `${safeBase}.avif`;
}

/** Persist an uploaded badge image under the configured storage dir (always AVIF). */
export async function storeBadgeGraphicFile(
  appKey: string,
  filename: string,
  data: Uint8Array,
  mimeType: string,
  options: { slug?: string } = {},
): Promise<string> {
  const cfg = getConfig();
  if (!ALLOWED_UPLOAD_MIME.has(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }
  if (data.byteLength > BADGE_GRAPHIC_UPLOAD_MAX_BYTES) {
    throw new Error(
      `File exceeds maximum upload size of ${BADGE_GRAPHIC_UPLOAD_MAX_BYTES} bytes`,
    );
  }

  const processed = await processBadgeGraphicUpload(data, {
    maxBytes: cfg.BADGE_GRAPHIC_MAX_BYTES,
  });
  if (processed.data.byteLength > cfg.BADGE_GRAPHIC_MAX_BYTES) {
    throw new Error(`Processed image exceeds maximum size of ${cfg.BADGE_GRAPHIC_MAX_BYTES} bytes`);
  }

  const safeName = resolveOutputFilename(filename, options.slug);
  const dir = path.join(cfg.BADGE_GRAPHIC_STORAGE_DIR, appKey);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, safeName);
  await writeFile(dest, processed.data);

  // Dev convenience: mirror into BADGE_GRAPHIC_FALLBACK_DIR so the sibling Badgy
  // public/ folder stays in sync when browsing that repo. Never used in production.
  const fallbackRoot = cfg.BADGE_GRAPHIC_FALLBACK_DIR.trim();
  if (fallbackRoot) {
    const fallbackDest = resolveFallbackPath(fallbackRoot, safeName);
    await mkdir(path.dirname(fallbackDest), { recursive: true });
    await writeFile(fallbackDest, processed.data);
  }

  return `/api/badge-graphics/assets/${encodeURIComponent(appKey)}/${encodeURIComponent(safeName)}`;
}

/** Resolve the on-disk path for a badge asset filename (primary storage only). */
export async function resolveBadgeGraphicAssetFile(
  appKey: string,
  filename: string,
): Promise<string | null> {
  const cfg = getConfig();
  const safeName = path.basename(filename);
  const primary = resolveStoragePath(cfg.BADGE_GRAPHIC_STORAGE_DIR, appKey, safeName);
  if (await fileExists(primary)) return primary;
  return null;
}

/** Read a stored badge image for the asset serve route. */
export async function readBadgeGraphicFile(
  appKey: string,
  filename: string,
): Promise<{ data: Buffer; mimeType: string; etag: string }> {
  const cfg = getConfig();
  const safeName = path.basename(filename);
  const ext = path.extname(safeName).toLowerCase();

  const primary = resolveStoragePath(cfg.BADGE_GRAPHIC_STORAGE_DIR, appKey, safeName);
  if (await fileExists(primary)) {
    const [data, fileStat] = await Promise.all([readFile(primary), stat(primary)]);
    return {
      data,
      mimeType: mimeFromExt(ext),
      etag: `"${Math.floor(fileStat.mtimeMs).toString(16)}-${fileStat.size.toString(16)}"`,
    };
  }

  const fallbackRoot = cfg.BADGE_GRAPHIC_FALLBACK_DIR.trim();
  if (fallbackRoot) {
    const fallback = resolveFallbackPath(fallbackRoot, safeName);
    if (await fileExists(fallback)) {
      const [data, fileStat] = await Promise.all([readFile(fallback), stat(fallback)]);
      return {
        data,
        mimeType: mimeFromExt(ext),
        etag: `"${Math.floor(fileStat.mtimeMs).toString(16)}-${fileStat.size.toString(16)}"`,
      };
    }
  }

  throw new Error("Asset not found");
}

/** Remove a CP-owned asset file (never touches the Badgy fallback directory). */
export async function deleteBadgeGraphicFile(
  appKey: string,
  imagePath: string,
): Promise<void> {
  const storedPath = stripBadgeGraphicAssetQuery(imagePath);
  const prefix = `/api/badge-graphics/assets/${encodeURIComponent(appKey)}/`;
  if (!storedPath.startsWith(prefix)) return;

  const filename = decodeURIComponent(storedPath.slice(prefix.length));
  const cfg = getConfig();
  const filePath = resolveStoragePath(cfg.BADGE_GRAPHIC_STORAGE_DIR, appKey, filename);
  try {
    await unlink(filePath);
  } catch {
    // Missing file is fine — metadata delete still proceeds.
  }
}
