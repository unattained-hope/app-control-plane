import type { LoaderFunctionArgs } from "react-router";
import { readBadgeGraphicFile } from "~/server/services/badgeGraphicStorage.js";

/**
 * Serves stored badge graphic assets (cp-app-settings). Public read — URLs are
 * opaque paths under `/api/badge-graphics/assets/:appKey/:filename`.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const appKey = params.appKey;
  const filename = params.filename;
  if (!appKey || !filename) {
    return new Response("not found", { status: 404 });
  }

  try {
    const { data, mimeType, etag } = await readBadgeGraphicFile(appKey, filename);
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
