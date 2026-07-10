import type { WebhookEvent } from "@prisma/client";
import { topicCategory } from "~/lib/shopifyWebhook.js";
import { getComplianceService } from "./complianceService.js";
import { getBillingMonitor } from "./billingMonitor.js";
import { getLifecycleService } from "./lifecycleService.js";

/**
 * Topic fan-out (cp-webhook-ingestion). Pure dispatch: route a persisted
 * `WebhookEvent` to the compliance or billing handler by topic. The worker owns
 * status transitions + retries; this only decides WHERE the work goes. An unknown
 * topic is acknowledged (no-op) so Shopify is not retried forever.
 */
export async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  switch (topicCategory(event.topic)) {
    case "compliance":
      await getComplianceService().handleWebhook(event);
      return;
    case "billing":
      await getBillingMonitor().handleWebhook(event);
      return;
    case "lifecycle":
      await getLifecycleService().handleWebhook(event);
      return;
    default:
      return;
  }
}
