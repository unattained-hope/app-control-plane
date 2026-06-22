import { getDb } from "../db.js";
import type { AppConnector } from "./types.js";
import {
  buildSaleSwitchConnector,
  type ReplicaReadSource,
} from "./saleswitchConnector.js";
import { makeFixtureSource } from "./fixtureSource.js";

/**
 * Connector registry (cp-app-registry-connector). Resolves the active connector
 * for an app `key` from the App registry row. The core routes every read through
 * the connector returned here and never references a raw app table.
 *
 * Onboarding a second app = register a builder here keyed by app key + insert a
 * registry row. NO core file outside this map changes (proven by the stub test,
 * which registers via `registerConnectorBuilder` without editing other files).
 */
export type ConnectorBuilder = (replicaRef: string) => Promise<AppConnector>;

const builders = new Map<string, ConnectorBuilder>();

/** Register a connector builder for an app key (the only wiring step for app #2). */
export function registerConnectorBuilder(
  key: string,
  builder: ConnectorBuilder,
): void {
  builders.set(key, builder);
}

// SaleSwitch's builder. The replica source is swappable (real replica client vs
// fixture); the MVP uses the in-memory fixture until D1 provisions a replica.
let saleswitchSource: ReplicaReadSource = makeFixtureSource();
export function __setSaleSwitchSource(source: ReplicaReadSource): void {
  saleswitchSource = source;
}
registerConnectorBuilder("saleswitch", (replicaRef) =>
  buildSaleSwitchConnector(replicaRef, saleswitchSource),
);

const connectorCache = new Map<string, AppConnector>();

/**
 * Resolve (and cache) the long-lived connector for an app key, looking up its
 * `replicaRef` in the registry. Throws if the app is not registered/active.
 */
export async function getConnector(appKey: string): Promise<AppConnector> {
  const cached = connectorCache.get(appKey);
  if (cached) return cached;

  const app = await getDb().app.findUnique({ where: { key: appKey } });
  if (!app || app.status !== "ACTIVE") {
    throw new Error(`No active app registered for key "${appKey}"`);
  }
  const builder = builders.get(appKey);
  if (!builder) {
    throw new Error(`No connector builder registered for key "${appKey}"`);
  }
  const connector = await builder(app.replicaRef);
  connectorCache.set(appKey, connector);
  return connector;
}

/** Test seam: clear the connector cache between cases. */
export function __clearConnectorCache(): void {
  connectorCache.clear();
}
