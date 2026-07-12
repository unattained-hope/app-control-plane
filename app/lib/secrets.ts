import { getConfig } from "./config.js";

/**
 * Secrets-manager adapter (cp-app-registry-connector AC2.2, cp-platform-infrastructure AC9.4).
 *
 * In production this resolves an `App.replicaRef` (a secrets-manager KEY, never a
 * raw DSN) into the actual replica connection string carrying the READ-ONLY role.
 *
 * MVP stub: resolves the canonical SaleSwitch ref from the validated config (which
 * is itself runtime-injected from the secrets manager). The seam exists so swapping
 * in AWS Secrets Manager / Vault is a one-file change with no caller edits.
 *
 * Encryption-key material is deliberately NOT resolvable here — this adapter only
 * vends read-only replica credentials (AC9.4: keys isolated from the read-only role).
 */
export interface SecretsManager {
  /** Resolve a replica DSN for a registry `replicaRef`. Throws if unknown. */
  resolveReplicaUrl(replicaRef: string): Promise<string>;
  /**
   * Resolve the Shopify webhook-signing secret for a registry `webhookSecretRef`
   * (cp-webhook-ingestion). MVP single-tenant reuses the app's `SHOPIFY_API_SECRET`;
   * multi-app stores one ref per registered app. Throws on an unknown ref.
   */
  resolveWebhookSecret(webhookSecretRef: string): Promise<string>;
  /**
   * Resolve the HMAC shared secret used to SIGN internal-API requests to an app
   * (usage-analytics Phase 2b). Must equal the app's own internal-API secret.
   * Throws on an unknown ref (fail-closed — ingestion refuses to call unsigned).
   */
  resolveInternalApiSecret(internalApiSecretRef: string): Promise<string>;
}

/** The single known replica ref in the MVP. Stored on the seeded App row. */
export const SALESWITCH_REPLICA_REF = "secret:saleswitch/replica-readonly";

/**
 * The canonical webhook-secret ref for the single MVP tenant. Multi-app stores a
 * per-app `webhookSecretRef` on the registry row (mirroring `replicaRef`).
 */
export const SALESWITCH_WEBHOOK_SECRET_REF = "secret:saleswitch/webhook-signing";

/** The HMAC signing-secret ref for the SaleSwitch internal API (usage ingestion). */
export const SALESWITCH_INTERNAL_API_REF = "secret:saleswitch/internal-api";

class EnvBackedSecretsManager implements SecretsManager {
  async resolveReplicaUrl(replicaRef: string): Promise<string> {
    if (replicaRef === SALESWITCH_REPLICA_REF) {
      return getConfig().SALESWITCH_REPLICA_URL;
    }
    throw new Error(
      `Unknown replicaRef "${replicaRef}" — no secret binding. The connector will ` +
        `NOT fall back to a primary or raw DSN connection.`,
    );
  }

  async resolveWebhookSecret(webhookSecretRef: string): Promise<string> {
    if (webhookSecretRef === SALESWITCH_WEBHOOK_SECRET_REF) {
      // Single-tenant MVP: Shopify signs app webhooks with the app's API secret.
      return getConfig().SHOPIFY_API_SECRET;
    }
    throw new Error(
      `Unknown webhookSecretRef "${webhookSecretRef}" — no secret binding. ` +
        `Webhook verification fails closed rather than accepting an unsigned event.`,
    );
  }

  async resolveInternalApiSecret(internalApiSecretRef: string): Promise<string> {
    if (internalApiSecretRef === SALESWITCH_INTERNAL_API_REF) {
      return getConfig().SALESWITCH_INTERNAL_API_SECRET;
    }
    throw new Error(
      `Unknown internalApiSecretRef "${internalApiSecretRef}" — no secret binding. ` +
        `Usage ingestion fails closed rather than calling the app API unsigned.`,
    );
  }
}

let instance: SecretsManager | null = null;
export function getSecretsManager(): SecretsManager {
  if (instance === null) {
    instance = new EnvBackedSecretsManager();
  }
  return instance;
}

/** Test seam: inject a fake secrets manager. */
export function __setSecretsManager(fake: SecretsManager): void {
  instance = fake;
}
