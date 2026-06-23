import { PrismaClient } from "@prisma/client";
import { getConfig } from "~/lib/config.js";

/**
 * The control-plane's OWN Postgres client (a singleton — one pool for the
 * persistent process). This is the ONLY database the control plane WRITES to.
 * SaleSwitch data is read via the connector's separate read-only replica client.
 */
const globalForPrisma = globalThis as unknown as {
  __cpPrisma?: PrismaClient;
};

export function getDb(): PrismaClient {
  if (!globalForPrisma.__cpPrisma) {
    globalForPrisma.__cpPrisma = new PrismaClient({
      datasourceUrl: getConfig().CONTROL_PLANE_DATABASE_URL,
    });
  }
  return globalForPrisma.__cpPrisma;
}

export type Db = PrismaClient;
