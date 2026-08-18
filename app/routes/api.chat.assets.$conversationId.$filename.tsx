import type { LoaderFunctionArgs } from "react-router";
import { readChatAttachmentFile } from "~/server/services/chatAttachmentStorage.js";

/**
 * Serves stored chat attachment files.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const conversationId = params.conversationId;
  const filename = params.filename;
  if (!conversationId || !filename) {
    return new Response("not found", { status: 404 });
  }

  try {
    const { data, mimeType, etag } = await readChatAttachmentFile(conversationId, filename);
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          "cache-control": "public, max-age=86400, must-revalidate",
        },
      });
    }

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "content-type": mimeType,
        "content-length": String(data.byteLength),
        etag,
        "cache-control": "public, max-age=86400, must-revalidate",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
