import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "~/lib/config.js";

/**
 * Host-minted, shop-scoped session tokens (cp-support-inbox AC7.2). The SaleSwitch
 * host mints a token for the current shop; the realtime backend verifies it and
 * scopes the connection to that shop. A connection minted for shop A cannot read
 * shop B's data. Tokens are short-lived HMACs over `{shop, appKey, exp}`.
 */
export interface ShopTokenClaims {
  readonly shop: string;
  readonly appKey: string;
  readonly exp: number; // epoch seconds
}

function secret(): string {
  // Reuse a server secret; in production a dedicated signing key from the secrets
  // manager. SHOPIFY_API_SECRET is host-side and never shipped to the widget.
  return getConfig().SHOPIFY_API_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Mint a shop-scoped token (called host-side, e.g. in the widget loader). */
export function mintShopToken(
  shop: string,
  appKey: string,
  ttlSeconds = 3600,
): string {
  const claims: ShopTokenClaims = {
    shop,
    appKey,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify a token; returns claims or null if invalid/expired/tampered. */
export function verifyShopToken(token: string): ShopTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, mac] = parts as [string, string];
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as ShopTokenClaims;
    if (claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Explicit CORS allow-list for the cross-origin handshake (AC7.2). Only the shop's
 * domain and admin.shopify.com are allowed frame/handshake origins.
 */
export function isAllowedOrigin(origin: string, shop: string): boolean {
  if (origin === "https://admin.shopify.com") return true;
  if (origin === `https://${shop}`) return true;
  return false;
}
