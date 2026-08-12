import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function deploymentFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("connector source deployment wiring", () => {
  it.each([
    "deploy/oci-production/compose.yaml",
    "deploy/oci-staging/docker-compose.yml",
  ])("pins the deployed control plane to the read replica in %s", (path) => {
    expect(deploymentFile(path)).toMatch(
      /x-control-plane-environment:[\s\S]*?SALESWITCH_CONNECTOR_SOURCE: replica/,
    );
  });

  it("pins the existing run-book production layout to the read replica", () => {
    expect(deploymentFile("deploy/oci-production/compose.legacy-overlay.yaml")).toMatch(
      /control-plane:\n\s+environment:\n\s+SALESWITCH_CONNECTOR_SOURCE: replica/,
    );
  });

  it("keeps Playwright isolated on fixture data", () => {
    expect(deploymentFile("playwright.config.ts")).toContain(
      "SALESWITCH_CONNECTOR_SOURCE=fixture",
    );
  });
});
