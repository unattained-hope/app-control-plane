import { test, expect } from "@playwright/test";

/**
 * Tracer bullet (cp-kpi-dashboard): proves the whole stack boots — RR7 server,
 * tRPC resource route, dev session, control-plane DB — and the dashboard renders
 * its KPI cards from the snapshot query. With no rollup yet, every card correctly
 * shows the "no snapshot" empty state (AC8.1 no-snapshots scenario).
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/dev-login?role=ADMIN&to=/");
});

test("dashboard renders the KPI region with all MVP metric cards", async ({ page }) => {
  const dash = page.getByRole("main", { name: "KPI dashboard" });
  await expect(dash).toBeVisible();

  // The MVP KPI set is rendered (active merchants, installs 7/30d, uninstalls,
  // MRR, plan distribution) — labels come straight from the route.
  for (const label of [
    "Active merchants",
    "New installs (7d)",
    "New installs (30d)",
    "Uninstalls",
    "MRR",
    "Plan distribution",
  ]) {
    await expect(dash.getByText(label, { exact: true })).toBeVisible();
  }

  // No rollup has run, so each KPI shows the explicit empty state, not a crash.
  await expect(dash.getByText("No snapshot yet").first()).toBeVisible();
  // It is snapshot-sourced — the page advertises no live joins.
  await expect(dash.getByText("Snapshot-sourced — no live joins")).toBeVisible();
});
