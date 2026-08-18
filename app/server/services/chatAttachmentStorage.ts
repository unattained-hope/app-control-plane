import { mkdir, writeFile, readFile, access, stat } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "~/lib/config.js";

/** Supported image & document mime types. */
const ALLOWED_MIME = new Set([
  "image/avif",
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "application/json",
  "text/csv",
  "text/markdown",
  "application/zip",
]);

function mimeFromExt(ext: string): string {
  switch (ext) {
    case ".avif":
      return "image/avif";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".txt":
    case ".log":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".md":
      return "text/markdown";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

function resolveStoragePath(storageDir: string, conversationId: string, filename: string): string {
  const safeName = path.basename(filename);
  const safeConvo = path.basename(conversationId);
  const filePath = path.join(storageDir, safeConvo, safeName);
  const resolved = path.resolve(filePath);
  const base = path.resolve(path.join(storageDir, safeConvo));
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error("Invalid asset path");
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

function resolveSafeFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename, ext).replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${base || "attachment"}-${timestamp}-${randomSuffix}${ext}`;
}

/** Store a chat attachment file on disk and return its public URL path. */
export async function storeChatAttachmentFile(
  conversationId: string,
  filename: string,
  data: Uint8Array,
  mimeType: string,
): Promise<string> {
  const cfg = getConfig();
  const maxBytes = cfg.CHAT_ATTACHMENT_MAX_BYTES;
  if (data.byteLength > maxBytes) {
    throw new Error(`File exceeds maximum upload size of ${maxBytes} bytes`);
  }

  const effectiveMime = ALLOWED_MIME.has(mimeType)
    ? mimeType
    : mimeFromExt(path.extname(filename).toLowerCase());

  const safeName = resolveSafeFilename(filename);
  const dir = path.join(cfg.CHAT_ATTACHMENT_STORAGE_DIR, conversationId);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, safeName);
  await writeFile(dest, data);

  return `/api/chat/assets/${encodeURIComponent(conversationId)}/${encodeURIComponent(safeName)}`;
}

/** Read a stored chat attachment for the asset serve route. */
export async function readChatAttachmentFile(
  conversationId: string,
  filename: string,
): Promise<{ data: Buffer; mimeType: string; etag: string }> {
  const cfg = getConfig();
  const safeName = path.basename(filename);
  const ext = path.extname(safeName).toLowerCase();

  const primary = resolveStoragePath(cfg.CHAT_ATTACHMENT_STORAGE_DIR, conversationId, safeName);
  if (await fileExists(primary)) {
    const [data, fileStat] = await Promise.all([readFile(primary), stat(primary)]);
    return {
      data,
      mimeType: mimeFromExt(ext),
      etag: `"${Math.floor(fileStat.mtimeMs).toString(16)}-${fileStat.size.toString(16)}"`,
    };
  }

  throw new Error("Attachment not found");
}
