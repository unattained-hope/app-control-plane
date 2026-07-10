import type { ActionFunctionArgs } from "react-router";
import { SHOPIFY_HEADERS, verifyShopifyHmac } from "~/lib/shopifyWebhook.js";
import { getWebhookService } from "~/server/services/webhookService.js";

/**
 * Shopify webhook endpoint (cp-webhook-ingestion) as an RR7 resource route — runs
 * identically under `react-router dev` and the production handler (parity with the
 * `trpc/*` route). `action`-only, no component.
 *
 * Flow: read the RAW body BEFORE parsing (HMAC is over raw bytes) → resolve the
 * per-app secret → constant-time HMAC verify. Invalid → 401 + a forensic
 * `WebhookEvent{hmacValid:false}`, no enqueue. Valid → idempotent persist + enqueue
 * + 200 immediately (Shopify retries on any non-2xx, so never block on processing).
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const raw = await request.text();
  const h = request.headers;
  const topic = h.get(SHOPIFY_HEADERS.topic) ?? "";
  const shop = h.get(SHOPIFY_HEADERS.shop);
  const webhookId = h.get(SHOPIFY_HEADERS.webhookId) ?? "";
  const hmac = h.get(SHOPIFY_HEADERS.hmac);

  const svc = getWebhookService();
  const appKey = svc.appKeyForShop(shop);

  let secret: string;
  try {
    secret = await svc.resolveSecret(appKey);
  } catch {
    // No secret binding for this app → fail closed, never accept an unsigned event.
    return new Response("unknown app", { status: 401 });
  }

  const input = { webhookId, topic, shop, appKey, raw };

  if (!verifyShopifyHmac(raw, hmac, secret)) {
    await svc.recordInvalid(input);
    return new Response("invalid hmac", { status: 401 });
  }

  await svc.ingest(input);
  return new Response(null, { status: 200 });
}
