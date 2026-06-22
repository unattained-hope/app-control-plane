import { describe, it, expect } from "vitest";
import { loadConfig, isAppAdminApiConfigured } from "~/lib/config.js";
import { validEnvObject } from "./helpers/env.js";

/** cp-platform-infrastructure — fail-fast zod config + app-API gating. */
describe("config", () => {
  it("loads a full valid env", () => {
    const cfg = loadConfig(validEnvObject());
    expect(cfg.CONTROL_PLANE_DATABASE_URL).toContain("postgresql://");
    expect(cfg.SUBSCRIPTION_CACHE_TTL_SECONDS).toBeGreaterThan(0);
  });

  it("throws when a required var is missing", () => {
    const env = validEnvObject();
    delete env.CONTROL_PLANE_DATABASE_URL;
    expect(() => loadConfig(env)).toThrow();
  });

  it("throws when a required var is malformed", () => {
    const env = validEnvObject();
    env.SALESWITCH_REPLICA_URL = "not-a-url";
    expect(() => loadConfig(env)).toThrow();
  });

  it("gates app-backed actions on BOTH admin API url + token", () => {
    const base = loadConfig(validEnvObject());
    expect(isAppAdminApiConfigured(base)).toBe(false);

    const withUrlOnly = loadConfig({
      ...validEnvObject(),
      SALESWITCH_ADMIN_API_URL: "https://api.example",
    } as NodeJS.ProcessEnv);
    expect(isAppAdminApiConfigured(withUrlOnly)).toBe(false);

    const withBoth = loadConfig({
      ...validEnvObject(),
      SALESWITCH_ADMIN_API_URL: "https://api.example",
      SALESWITCH_ADMIN_API_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(isAppAdminApiConfigured(withBoth)).toBe(true);
  });
});
