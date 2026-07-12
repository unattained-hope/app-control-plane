import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";

beforeAll(() => stubValidEnv());

// Import after env is set (modules read getConfig() lazily, but be safe).
const { mintShopToken, verifyShopToken, isAllowedOrigin } = await import(
  "~/server/realtime/sessionToken.js"
);

/** cp-support-inbox — host-minted shop-scoped tokens + explicit-origin CORS. */
describe("shop session tokens", () => {
  it("round-trips and returns the shop + appKey claims", () => {
    const token = mintShopToken("aurora-threads.myshopify.com", "saleswitch");
    const claims = verifyShopToken(token);
    expect(claims).not.toBeNull();
    expect(claims!.shop).toBe("aurora-threads.myshopify.com");
    expect(claims!.appKey).toBe("saleswitch");
  });

  it("rejects a tampered token", () => {
    const token = mintShopToken("aurora-threads.myshopify.com", "saleswitch");
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(verifyShopToken(tampered)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = mintShopToken("s.myshopify.com", "saleswitch", -10);
    expect(verifyShopToken(expired)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyShopToken("not-a-token")).toBeNull();
    expect(verifyShopToken("")).toBeNull();
  });

  it("allows only admin.shopify.com and the shop's own origin (non-dev)", () => {
    const shop = "aurora-threads.myshopify.com";
    expect(isAllowedOrigin("https://admin.shopify.com", shop)).toBe(true);
    expect(isAllowedOrigin(`https://${shop}`, shop)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", shop)).toBe(false);
    // NODE_ENV=test in vitest — localhost dev bypass is off here.
    expect(isAllowedOrigin("http://localhost:5173", shop)).toBe(false);
  });
});
