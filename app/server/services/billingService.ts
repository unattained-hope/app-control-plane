import { getConfig } from "~/lib/config.js";
import { captureError } from "~/lib/observability.js";
import { getConnector } from "../connectors/registry.js";
import type { SubscriptionState } from "../connectors/types.js";

/**
 * Subscription/billing reads (cp-billing-read). State is read LIVE from Shopify
 * (`currentAppInstallation.activeSubscriptions` per shop). The control plane owns
 * NO billing ledger. Reads are cached with a short TTL to respect Shopify rate
 * limits; cache miss with a failed live read degrades gracefully (never throws to
 * the view); a stale prior value may be served clearly marked.
 */
export interface ShopifySubscriptionReader {
  read(shop: string): Promise<SubscriptionState>;
}

interface CacheEntry {
  readonly state: SubscriptionState;
  readonly expiresAt: number;
}

export class BillingService {
  private readonly cache = new Map<string, CacheEntry>();
  // Coalesce concurrent reads per shop so a burst hits Shopify at most once/TTL.
  private readonly inflight = new Map<string, Promise<SubscriptionState>>();

  constructor(private readonly reader: ShopifySubscriptionReader) {}

  async getSubscription(shop: string): Promise<SubscriptionState> {
    const now = Date.now();
    const cached = this.cache.get(shop);
    if (cached && cached.expiresAt > now) {
      return cached.state; // cache hit within TTL — no Shopify call (AC6.3)
    }

    const existing = this.inflight.get(shop);
    if (existing) return existing;

    const ttlMs = getConfig().SUBSCRIPTION_CACHE_TTL_SECONDS * 1000;
    const p = (async (): Promise<SubscriptionState> => {
      try {
        const fresh = await this.reader.read(shop);
        this.cache.set(shop, { state: fresh, expiresAt: Date.now() + ttlMs });
        return fresh;
      } catch (err) {
        captureError(err, { where: "billingService.getSubscription", shop });
        // Stale-while-error: serve the last known value clearly marked.
        if (cached) {
          return { ...cached.state, stale: true };
        }
        // No cache + live failure: graceful "unavailable", never fabricated fields.
        return {
          shop,
          planName: null,
          status: "none",
          price: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          stale: true,
        };
      } finally {
        this.inflight.delete(shop);
      }
    })();
    this.inflight.set(shop, p);
    return p;
  }
}

/**
 * Shopify reader (cp-billing-read AC6.1). The real reader issues the Admin API
 * GraphQL `currentAppInstallation { activeSubscriptions { ... } }` per shop.
 * MVP stub returns a "none" baseline so the detail view renders without live creds;
 * swap this for the real GraphQL client once Shopify scopes (D4) are wired.
 */
export class StubShopifySubscriptionReader implements ShopifySubscriptionReader {
  async read(shop: string): Promise<SubscriptionState> {
    return {
      shop,
      planName: null,
      status: "none",
      price: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
  }
}

/**
 * Connector-backed reader (cp-billing-monitoring). The control plane holds NO
 * per-shop Shopify token, so the subscription state is read through the app
 * connector against the REPLICA (`AppConnector.getSubscription()`) rather than a
 * direct Shopify call. This keeps reads replica-only; the BillingService's TTL
 * cache + stale-while-error behavior wraps it unchanged. A direct Shopify Admin API
 * reader remains a later option if sub-replica-lag freshness is ever required.
 */
export class ConnectorSubscriptionReader implements ShopifySubscriptionReader {
  constructor(private readonly appKey = "saleswitch") {}

  async read(shop: string): Promise<SubscriptionState> {
    const connector = await getConnector(this.appKey);
    return connector.getSubscription(shop);
  }
}

let instance: BillingService | null = null;
export function getBillingService(): BillingService {
  if (!instance) instance = new BillingService(new ConnectorSubscriptionReader());
  return instance;
}
export function __setBillingService(svc: BillingService): void {
  instance = svc;
}
