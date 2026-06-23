import { PrismaClient } from "@prisma/client";
import { SALESWITCH_REPLICA_REF } from "../app/lib/secrets.js";

/**
 * Seed the App registry with SaleSwitch as the SOLE MVP app
 * (cp-app-registry-connector AC2.1). `replicaRef` is a secrets-manager KEY, never
 * a raw DSN.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.app.upsert({
    where: { key: "saleswitch" },
    create: {
      key: "saleswitch",
      name: "SaleSwitch",
      status: "ACTIVE",
      replicaRef: SALESWITCH_REPLICA_REF,
      enabledModules: ["merchants", "billing", "chat", "dashboard"],
    },
    update: {
      name: "SaleSwitch",
      status: "ACTIVE",
      replicaRef: SALESWITCH_REPLICA_REF,
      enabledModules: ["merchants", "billing", "chat", "dashboard"],
    },
  });
  // eslint-disable-next-line no-console
  console.log("Seeded App registry: saleswitch");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
