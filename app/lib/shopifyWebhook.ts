import { createHmac, timingSafeEqual } from "node:crypto";
import type { ComplianceTopic } from "@prisma/client";

/**
 * Shopify webhook primitives (cp-webhook-ingestion). Pure functions only — no
 * environment access, no DB — so the architecture guard stays green and the HMAC
 * logic is trivially unit-testable. The secret is always passed in by the caller,
 * which resolves it per-app through the secrets seam.
 */

/** Header names Shopify sends on every webhook delivery. */
export const SHOPIFY_HEADERS = {
  hmac: "x-shopify-hmac-sha256",
  topic: "x-shopify-topic",
  shop: "x-shopify-shop-domain",
  webhookId: "x-shopify-webhook-id",
  apiVersion: "x-shopify-api-version",
} as const;

/** The three mandatory GDPR/data-subject-request topics (rejection-gating). */
export const COMPLIANCE_TOPICS = [
  "customers/data_request",
  "customers/redact",
  "shop/redact",
] as const;

/** Subscription-lifecycle topics (subscribe-to-receive, not rejection-gating). */
export const BILLING_TOPICS = [
  "app_subscriptions/update",
  "app_subscriptions/approaching_capped_amount",
] as const;

/** App-lifecycle topics (cp-uninstall-churn). `app/uninstalled` drives the churn flow. */
export const LIFECYCLE_TOPICS = ["app/uninstalled"] as const;

export type WebhookCategory = "compliance" | "billing" | "lifecycle" | "other";

/** Classify a raw Shopify topic string into the worker's dispatch branch. */
export function topicCategory(topic: string): WebhookCategory {
  if ((COMPLIANCE_TOPICS as readonly string[]).includes(topic)) return "compliance";
  if ((BILLING_TOPICS as readonly string[]).includes(topic)) return "billing";
  if ((LIFECYCLE_TOPICS as readonly string[]).includes(topic)) return "lifecycle";
  return "other";
}

/** Map a compliance topic string to the Prisma `ComplianceTopic` enum, or null. */
export function complianceTopicEnum(topic: string): ComplianceTopic | null {
  switch (topic) {
    case "customers/data_request":
      return "CUSTOMERS_DATA_REQUEST";
    case "customers/redact":
      return "CUSTOMERS_REDACT";
    case "shop/redact":
      return "SHOP_REDACT";
    default:
      return null;
  }
}

/**
 * Verify a Shopify webhook signature: base64 HMAC-SHA256 of the RAW body with the
 * app secret, constant-time compared to the `X-Shopify-Hmac-Sha256` header. Returns
 * false on a missing/malformed header or length mismatch (never throws).
 */
export function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }
  // timingSafeEqual requires equal lengths; a length mismatch is a non-match.
  if (provided.length !== digest.length) return false;
  return timingSafeEqual(digest, provided);
}
