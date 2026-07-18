import type { ActionFunctionArgs } from "react-router";
import { resolveDevIdentity } from "~/server/devSession.js";
import { resolveIdentity } from "~/server/auth.js";
import { roleCan } from "~/server/rbac.js";
import { storeBadgeGraphicFile } from "~/server/services/badgeGraphicStorage.js";

const DEFAULT_APP_KEY = "saleswitch";

function mimeFromFilename(name: string): string | null {
  switch (name.toLowerCase().split(".").pop()) {
    case "avif":
      return "image/avif";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    default:
      return null;
  }
}

/**
 * Multipart upload for badge graphic images (cp-app-settings). ADMIN-only via
 * session cookie (role login). Returns the public asset URL path.
 */
export async function action({ request }: ActionFunctionArgs) {
  const identity =
    (await resolveDevIdentity(request.headers)) ??
    (await resolveIdentity(request.headers));
  if (!identity || !roleCan(identity.role, "settings:manage")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const appKey = url.searchParams.get("app") ?? DEFAULT_APP_KEY;
  const slug = url.searchParams.get("slug")?.trim() || undefined;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type || mimeFromFilename(file.name) || "application/octet-stream";
    const imagePath = await storeBadgeGraphicFile(appKey, file.name, data, mimeType, { slug });
    return Response.json({ imagePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
