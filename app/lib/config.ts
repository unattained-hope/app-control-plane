import { z } from "zod";

/**
 * The single source of validated environment configuration.
 *
 * INVARIANT (cp-platform-infrastructure / AC9.4): `process.env` is read ONLY in
 * this module. Everywhere else imports `config`. A lint guard
 * (scripts/check-no-app-db-writes.mjs) asserts no other `process.env` access.
 *
 * Mirrors the SaleSwitch/Badgy `server/lib/config.ts` convention: fail fast at
 * startup if any required variable is missing or malformed.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Control plane's OWN Postgres.
  CONTROL_PLANE_DATABASE_URL: z.string().url(),

  // SaleSwitch read-replica DSN (read-only role). Resolved via secrets manager
  // in production; validated here as the runtime-injected value.
  SALESWITCH_REPLICA_URL: z.string().url(),

  // Redis backs BullMQ + the Socket.IO adapter.
  REDIS_URL: z.string().url(),

  // WorkOS AuthKit.
  WORKOS_API_KEY: z.string().min(1),
  WORKOS_CLIENT_ID: z.string().min(1),
  WORKOS_REDIRECT_URI: z.string().url().default("http://localhost:3000/auth/callback"),
  WORKOS_COOKIE_PASSWORD: z.string().min(32),

  // Shopify Admin API (subscription reads).
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),

  // Observability.
  SENTRY_DSN: z.string().default(""),

  // Optional SaleSwitch admin API (D2). Absent => app-backed actions hidden.
  SALESWITCH_ADMIN_API_URL: z.string().url().optional().or(z.literal("")),
  SALESWITCH_ADMIN_API_TOKEN: z.string().optional().or(z.literal("")),

  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  SUBSCRIPTION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
});

export type AppConfig = Readonly<z.infer<typeof EnvSchema>>;

/**
 * Parse and validate the environment. Throws (aborting startup) on any missing
 * or malformed required variable — never serves requests with invalid config.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid control-plane environment configuration:\n${issues}\n` +
        `Set these via the secrets manager / .env (see .env.example).`,
    );
  }
  return Object.freeze(parsed.data);
}

/**
 * Lazily-initialised, process-wide validated config. Import this everywhere
 * instead of touching `process.env`.
 */
let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (cached === null) {
    cached = loadConfig();
  }
  return cached;
}

/** Whether the SaleSwitch admin API (D2) is configured. Gates app-backed actions. */
export function isAppAdminApiConfigured(cfg: AppConfig = getConfig()): boolean {
  return Boolean(cfg.SALESWITCH_ADMIN_API_URL && cfg.SALESWITCH_ADMIN_API_TOKEN);
}
