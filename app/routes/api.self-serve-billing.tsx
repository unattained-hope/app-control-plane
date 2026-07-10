import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { verifyShopToken, isAllowedOrigin } from "~/server/realtime/sessionToken.js";
import { getPlanChangeService } from "~/server/services/planChangeService.js";

/**
 * Merchant-facing self-serve billing (cp-self-serve-billing) as an RR7 resource route.
 * Authenticated by the host-minted, shop-scoped token (the same as the chat widget) —
 * NOT CASL, because the actor is a merchant, not a staff user. GET returns the current
 * subscription + available plans; POST requests a plan change (recorded + dispatched to
 * the app admin API, or a support-conversation fallback). The control plane never
 * mutates billing directly.
 */

function authShop(request: Request): { shop: string; appKey: string } | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const claims = verifyShopToken(token);
  if (!claims) return null;
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin, claims.shop)) return null;
  return { shop: claims.shop, appKey: claims.appKey };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const claims = authShop(request);
  if (!claims) return Response.json({ error: "unauthorized" }, { status: 401 });
  const options = await getPlanChangeService().getOptions(claims.shop);
  return Response.json(options);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const claims = authShop(request);
  if (!claims) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { toPlan?: unknown; fromPlan?: unknown };
  if (typeof body.toPlan !== "string" || body.toPlan.trim().length === 0) {
    return Response.json({ error: "toPlan is required" }, { status: 400 });
  }
  const fromPlan = typeof body.fromPlan === "string" ? body.fromPlan : null;
  const result = await getPlanChangeService().requestChange(
    claims.appKey,
    claims.shop,
    body.toPlan.trim(),
    fromPlan,
  );
  return Response.json({
    id: result.id,
    status: result.status,
    confirmationUrl: result.confirmationUrl,
    conversationId: result.conversationId,
  });
}
