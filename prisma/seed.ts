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
      enabledModules: ["merchants", "billing", "chat", "dashboard", "settings", "usage"],
      defaultBadgeGraphicSlug: "retro-sale",
    },
    update: {
      name: "SaleSwitch",
      status: "ACTIVE",
      replicaRef: SALESWITCH_REPLICA_REF,
      enabledModules: ["merchants", "billing", "chat", "dashboard", "settings", "usage"],
      defaultBadgeGraphicSlug: "retro-sale",
    },
  });
  // eslint-disable-next-line no-console
  console.log("Seeded App registry: saleswitch");

  const fixtures = [
    {
      slug: "minimal-sale",
      label: "Sale",
      imagePath: "/api/badge-graphics/assets/saleswitch/minimal-sale.avif",
      textBaked: true,
      theme: "MINIMAL",
      graphicType: "OFFER",
      sortOrder: 0,
    },
    {
      slug: "minimal-new",
      label: "New",
      imagePath: "/api/badge-graphics/assets/saleswitch/minimal-new.avif",
      textBaked: true,
      theme: "MINIMAL",
      graphicType: "TRUST",
      sortOrder: 1,
    },
    {
      slug: "retro-black-friday",
      label: "Black Friday",
      imagePath: "/api/badge-graphics/assets/saleswitch/retro-black-friday.avif",
      textBaked: true,
      theme: "RETRO",
      graphicType: "OCCASION",
      sortOrder: 2,
    },
    {
      slug: "retro-sale",
      label: "Sale",
      imagePath: "/api/badge-graphics/assets/saleswitch/retro-sale.avif",
      textBaked: true,
      theme: "RETRO",
      graphicType: "OFFER",
      sortOrder: 3,
    },
    {
      slug: "elegant-premium",
      label: "Premium",
      imagePath: "/api/badge-graphics/assets/saleswitch/elegant-premium.avif",
      textBaked: true,
      theme: "ELEGANT",
      graphicType: "TRUST",
      sortOrder: 4,
    },
    {
      slug: "minimal-blank-circle",
      label: "Blank Circle",
      imagePath: "/api/badge-graphics/assets/saleswitch/minimal-blank-circle.avif",
      textBaked: false,
      theme: "MINIMAL",
      graphicType: "BLANK",
      sortOrder: 5,
    },
  ] as const;

  for (const row of fixtures) {
    await prisma.badgeGraphic.upsert({
      where: { appKey_slug: { appKey: "saleswitch", slug: row.slug } },
      create: { appKey: "saleswitch", ...row },
      update: { ...row },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${fixtures.length} badge graphics for saleswitch`);

  // Default usage alert rules (cp usage-alerts-digest, P5). Seeded DISABLED — enabled
  // individually from the ADMIN UI once two weeks of Phase 3/4 data justify the
  // thresholds (defaults mirror the USAGE_ALERT_* config). Idempotent on (appKey, key);
  // the update deliberately does NOT touch `enabled`/`threshold`, so a re-seed never
  // re-enables a rule an admin turned on or overrides a threshold they tuned.
  const alertRules = [
    {
      key: "wizard-completion-drop",
      label: "Wizard completion conversion dropped",
      metricKind: "METRIC_WOW_POINTS" as const,
      metric: "usage.funnel.stage",
      dimension: "completed",
      comparison: "DROP_GT" as const,
      threshold: 0.1, // USAGE_ALERT_FUNNEL_DROP_POINTS
    },
    {
      key: "dormant-spike",
      label: "DORMANT cohort spiked",
      metricKind: "COHORT_TRANSITION" as const,
      metric: "DORMANT",
      dimension: "",
      comparison: "RISE_GT" as const,
      threshold: 0.25, // USAGE_ALERT_DORMANT_RISE_PERCENT (as a count delta floor at enablement)
    },
    {
      key: "wau-drop",
      label: "Weekly-active shops dropped",
      metricKind: "METRIC_WOW_PERCENT" as const,
      metric: "usage.active.wau",
      dimension: "",
      comparison: "DROP_GT" as const,
      threshold: 0.2, // USAGE_ALERT_WAU_DROP_PERCENT
    },
  ] as const;

  for (const rule of alertRules) {
    await prisma.usageAlertRule.upsert({
      where: { appKey_key: { appKey: "saleswitch", key: rule.key } },
      create: { appKey: "saleswitch", enabled: false, ...rule },
      // Keep identity/wiring current WITHOUT touching admin-tuned enabled/threshold.
      update: {
        label: rule.label,
        metricKind: rule.metricKind,
        metric: rule.metric,
        dimension: rule.dimension,
        comparison: rule.comparison,
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${alertRules.length} usage alert rules for saleswitch (disabled)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
