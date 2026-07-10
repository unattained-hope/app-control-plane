import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyShopifyHmac,
  topicCategory,
  complianceTopicEnum,
} from "~/lib/shopifyWebhook.js";

/** cp-webhook-ingestion — HMAC verification + topic routing (pure). */
function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("verifyShopifyHmac", () => {
  const secret = "shhh-secret";
  const body = JSON.stringify({ shop: "aurora.myshopify.com", id: 42 });

  it("accepts a correct signature", () => {
    expect(verifyShopifyHmac(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyShopifyHmac(`${body} `, sign(body, secret), secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyShopifyHmac(body, sign(body, "other-secret"), secret)).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyShopifyHmac(body, null, secret)).toBe(false);
    expect(verifyShopifyHmac(body, "not-a-real-signature", secret)).toBe(false);
  });
});

describe("topic routing", () => {
  it("categorizes compliance / billing / other topics", () => {
    expect(topicCategory("customers/data_request")).toBe("compliance");
    expect(topicCategory("customers/redact")).toBe("compliance");
    expect(topicCategory("shop/redact")).toBe("compliance");
    expect(topicCategory("app_subscriptions/update")).toBe("billing");
    expect(topicCategory("app_subscriptions/approaching_capped_amount")).toBe("billing");
    expect(topicCategory("orders/create")).toBe("other");
  });

  it("maps compliance topic strings to the Prisma enum", () => {
    expect(complianceTopicEnum("customers/data_request")).toBe("CUSTOMERS_DATA_REQUEST");
    expect(complianceTopicEnum("customers/redact")).toBe("CUSTOMERS_REDACT");
    expect(complianceTopicEnum("shop/redact")).toBe("SHOP_REDACT");
    expect(complianceTopicEnum("app_subscriptions/update")).toBeNull();
  });
});
