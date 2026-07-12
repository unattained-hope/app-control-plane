import { redirect, type LoaderFunctionArgs } from "react-router";
import { getConfig } from "~/lib/config.js";
import { mintShopToken } from "~/server/realtime/sessionToken.js";

/**
 * DEV-ONLY merchant chat harness: `/dev-chat?shop=foo.myshopify.com` mints a
 * shop-scoped token and redirects to `/dev-chat/panel` where the reference
 * ChatWidget connects over Socket.IO. 404s in production.
 */
export function loader({ request }: LoaderFunctionArgs) {
  if (getConfig().NODE_ENV !== "development") {
    throw new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "dev-shop.myshopify.com";
  const token = mintShopToken(shop, "saleswitch");
  return redirect(`/dev-chat/panel?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}`);
}
