import type { ActionFunctionArgs } from "react-router";
import { resolveDevIdentity } from "~/server/devSession.js";
import { resolveIdentity } from "~/server/auth.js";
import { roleCan } from "~/server/rbac.js";
import { verifyShopToken } from "~/server/realtime/sessionToken.js";
import { storeChatAttachmentFile } from "~/server/services/chatAttachmentStorage.js";

/**
 * Multipart upload for support chat attachments (images, screenshots, logs).
 * ADMIN/SUPPORT agents or authenticated merchants with valid shop token.
 * Returns the public asset URL path.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const identity =
    (await resolveDevIdentity(request.headers)) ??
    (await resolveIdentity(request.headers));

  let isAuthorized = identity ? roleCan(identity.role, "reply") : false;

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 });
  }

  // If not an agent identity, check for a valid merchant shop session token
  if (!isAuthorized) {
    const authHeader = request.headers.get("authorization") || "";
    const token =
      authHeader.replace(/^Bearer\s+/i, "").trim() ||
      request.headers.get("x-shop-token")?.trim() ||
      url.searchParams.get("token")?.trim();

    if (token) {
      const claims = verifyShopToken(token);
      if (claims) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";
    const attachmentUrl = await storeChatAttachmentFile(
      conversationId,
      file.name || "attachment",
      data,
      mimeType,
    );
    return Response.json({ attachmentUrl, filename: file.name, size: file.size, mimeType });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
