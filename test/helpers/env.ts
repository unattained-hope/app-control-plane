/** Shared valid env for tests that touch getConfig() (cp-platform-infrastructure). */
export function stubValidEnv(): void {
  const e = process.env;
  e.NODE_ENV = "test";
  e.CONTROL_PLANE_DATABASE_URL = "postgresql://u:p@localhost:5432/cp";
  e.SALESWITCH_REPLICA_URL = "postgresql://ro:ro@localhost:5432/saleswitch";
  e.REDIS_URL = "redis://localhost:6379";
  e.WORKOS_API_KEY = "sk_test_x";
  e.WORKOS_CLIENT_ID = "client_x";
  e.WORKOS_COOKIE_PASSWORD = "abcdefghijklmnopqrstuvwxyz0123456789";
  e.SHOPIFY_API_KEY = "sk_x";
  e.SHOPIFY_API_SECRET = "secret_x";
}

export function validEnvObject(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    CONTROL_PLANE_DATABASE_URL: "postgresql://u:p@localhost:5432/cp",
    SALESWITCH_REPLICA_URL: "postgresql://ro:ro@localhost:5432/saleswitch",
    REDIS_URL: "redis://localhost:6379",
    WORKOS_API_KEY: "sk_test_x",
    WORKOS_CLIENT_ID: "client_x",
    WORKOS_COOKIE_PASSWORD: "abcdefghijklmnopqrstuvwxyz0123456789",
    SHOPIFY_API_KEY: "sk_x",
    SHOPIFY_API_SECRET: "secret_x",
  } as NodeJS.ProcessEnv;
}
