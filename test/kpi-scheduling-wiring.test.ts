import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function sourceFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/** cp-kpi-dashboard — every long-lived runtime must schedule snapshot refreshes. */
describe("KPI rollup runtime wiring", () => {
  it.each(["server/prod.ts", "app/server/workers/devWorker.ts"])(
    "schedules the SaleSwitch KPI rollup in %s",
    (path) => {
      const source = sourceFile(path);
      expect(source).toMatch(/import \{[^}]*scheduleKpiRollup[^}]*\} from [^;]+kpiRollup\.js/);
      expect(source).toContain('scheduleKpiRollup("saleswitch")');
    },
  );

  it("primes snapshots immediately as well as registering the recurring job", () => {
    const source = sourceFile("app/server/workers/kpiRollup.ts");
    expect(source.match(/await queue\.add\(/g)).toHaveLength(2);
    expect(source).toContain("repeat: { pattern: cron }");
  });
});
