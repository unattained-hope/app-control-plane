import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { getConfig } from "~/lib/config.js";
import { publicBadgeGraphicAssetUrl } from "~/lib/badgeGraphicUrls.js";
import { getBadgeGraphicService } from "~/server/services/badgeGraphicService.js";

/**
 * Narrow badge-graphic read endpoint (cp-app-settings). The SaleSwitch app PULLS
 * its built-in IMAGE badge gallery from here. Guarded by `BADGE_GRAPHIC_READ_TOKEN`
 * bearer (fail-closed when unset).
 */

const DEFAULT_APP_KEY = "saleswitch";

function tokenMatches(presented: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const cfg = getConfig();
  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!tokenMatches(presented, cfg.BADGE_GRAPHIC_READ_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const appKey = url.searchParams.get("app") ?? DEFAULT_APP_KEY;
  const svc = getBadgeGraphicService();
  const [graphics, defaultSlug] = await Promise.all([
    svc.listActiveForApp(appKey),
    svc.getDefaultSlug(appKey),
  ]);
  return Response.json({
    appKey,
    defaultSlug,
    graphics: graphics.map((g) => ({
      ...g,
      imagePath: publicBadgeGraphicAssetUrl(g.imagePath, cfg),
    })),
  });
}
