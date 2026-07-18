import { __resetConfigForTests } from "~/lib/config.js";

/** Shared valid env for tests that touch getConfig() (cp-platform-infrastructure). */
export function stubValidEnv(): void {
  const e = process.env;
  e.NODE_ENV = "test";
  e.CONTROL_PLANE_DATABASE_URL = "postgresql://u:p@localhost:5432/cp";
  e.SALESWITCH_REPLICA_URL = "postgresql://ro:ro@localhost:5432/saleswitch";
  e.REDIS_URL = "redis://localhost:6379";
  e.SHOPIFY_API_KEY = "sk_x";
  e.SHOPIFY_API_SECRET = "secret_x";
  // Drop any config memoised by an earlier test file so this suite's env (including the
  // extra vars a suite sets right after this call) is what the next getConfig() reads.
  // Fixes cross-file config-cache leakage that otherwise makes gated-flag tests flaky.
  __resetConfigForTests();
}

export function validEnvObject(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    CONTROL_PLANE_DATABASE_URL: "postgresql://u:p@localhost:5432/cp",
    SALESWITCH_REPLICA_URL: "postgresql://ro:ro@localhost:5432/saleswitch",
    REDIS_URL: "redis://localhost:6379",
    SHOPIFY_API_KEY: "sk_x",
    SHOPIFY_API_SECRET: "secret_x",
  } as NodeJS.ProcessEnv;
}
