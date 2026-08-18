import type { ActionFunctionArgs } from "react-router";
import { resolveDevIdentity } from "~/server/devSession.js";
import { resolveIdentity } from "~/server/auth.js";
import { roleCan } from "~/server/rbac.js";
import { storeChatAttachmentFile } from "~/server/services/chatAttachmentStorage.js";

/**
 * Multipart upload for support chat attachments (images, screenshots, logs).
 * ADMIN/SUPPORT only. Returns the public asset URL path.
 */
export async function action({ request }: ActionFunctionArgs) {
  const identity =
    (await resolveDevIdentity(request.headers)) ??
    (await resolveIdentity(request.headers));
  if (!identity || !roleCan(identity.role, "reply")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 });
  }

  const formData = await request.formData();
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
