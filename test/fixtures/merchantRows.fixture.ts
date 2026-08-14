import type { RawShopRow } from "~/server/connectors/saleswitchConnector.js";

/** Test-local connector rows. Production fixture mode deliberately contains none. */
export const MERCHANT_ROWS_FIXTURE: readonly RawShopRow[] = [
  {
    shopDomain: "test-alpha.myshopify.com",
    displayName: "Test Alpha",
    contactEmail: "alpha@example.test",
    status: "active",
    lifecycle: "active",
    plan: "Pro",
    installedAt: new Date("2026-01-01T00:00:00.000Z"),
    uninstalledAt: null,
  },
  {
    shopDomain: "test-beta.myshopify.com",
    displayName: "Test Beta",
    contactEmail: "beta@example.test",
    status: "installing",
    lifecycle: "onboarding",
    plan: null,
    installedAt: new Date("2026-02-01T00:00:00.000Z"),
    uninstalledAt: null,
  },
  {
    shopDomain: "test-gamma.myshopify.com",
    displayName: "Test Gamma",
    contactEmail: "gamma@example.test",
    status: "uninstalled",
    lifecycle: "churned",
    plan: "Starter",
    installedAt: new Date("2025-12-01T00:00:00.000Z"),
    uninstalledAt: new Date("2026-03-01T00:00:00.000Z"),
  },
];
