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

  // Support-desk SLA office-hours policy (cp-inbox-sla). A single business window
  // (no holiday calendar in MVP): minutes east of UTC + daily open/close hour, and
  // the warning window that flips an open conversation to BREACHING before due.
  BUSINESS_TZ_OFFSET_MINUTES: z.coerce.number().int().default(0),
  BUSINESS_OPEN_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  BUSINESS_CLOSE_HOUR: z.coerce.number().int().min(1).max(24).default(17),
  SLA_BREACH_WARNING_MINUTES: z.coerce.number().int().positive().default(30),

  // --- Tier 2: scale-readiness / ops resilience ---

  // Portfolio monitoring (cp-ops-monitoring). Bearer token guarding the `/metrics`
  // scrape endpoint (in addition to the zero-trust gateway). Empty => the endpoint
  // refuses every request (fail-closed) until a token is injected.
  METRICS_AUTH_TOKEN: z.string().default(""),
  // Ops-KPI rollup cadence + the window after which a queue with no completed job
  // is treated as a stale/unhealthy worker on the monitoring tiles.
  OPS_ROLLUP_CRON: z.string().default("*/5 * * * *"),
  WORKER_LIVENESS_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  // Webhook reliability (cp-webhook-reliability). Retry ceiling + backoff cap before
  // an event is dead-lettered.
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WEBHOOK_BACKOFF_CEILING_MS: z.coerce.number().int().positive().default(60_000),

  // SLO alerting (cp-slo-alerting). Objective (success ratio) + the Google-SRE
  // multiwindow multi-burn-rate tiers. Page tiers fire on a fast+slow window pair;
  // the ticket tier on the long window. Defaults are the SRE 99.9% reference.
  SLO_DELIVERY_OBJECTIVE: z.coerce.number().min(0).max(1).default(0.999),
  SLO_AVAILABILITY_OBJECTIVE: z.coerce.number().min(0).max(1).default(0.999),
  SLO_BURN_PAGE_FAST: z.coerce.number().positive().default(14.4),
  SLO_BURN_PAGE_SLOW: z.coerce.number().positive().default(6),
  SLO_BURN_TICKET: z.coerce.number().positive().default(1),
  SLO_WINDOW_FAST_MINUTES: z.coerce.number().int().positive().default(60),
  SLO_WINDOW_SLOW_MINUTES: z.coerce.number().int().positive().default(360),
  SLO_WINDOW_TICKET_MINUTES: z.coerce.number().int().positive().default(4_320),

  // Break-glass / justified access (cp-break-glass-rbac). Grant lifetime, and whether
  // PII reveal / impersonation are "sensitive" (require ADMIN approval before active).
  BREAK_GLASS_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  // Env booleans: only the literal "true"/"1" is truthy (z.coerce.boolean treats the
  // string "false" as true, which is the wrong default here).
  BREAK_GLASS_PII_REQUIRES_APPROVAL: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  BREAK_GLASS_IMPERSONATION_REQUIRES_APPROVAL: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),

  // --- Tier 3: growth & retention ---

  // Growth rollup cadence (cp-merchant-health / cp-announcements-nps). Health + churn
  // + NPS move slowly, so this is less frequent than the ops rollup (hourly default).
  GROWTH_ROLLUP_CRON: z.string().default("0 * * * *"),

  // Merchant health scoring weights + band cutoffs (cp-merchant-health). The score is
  // a transparent weighted PENALTY sum (0 = perfectly healthy; higher = worse); a shop
  // at/above CRITICAL is CRITICAL, at/above AT_RISK is AT_RISK, else HEALTHY. Weights
  // are best-practice (roadmap "honest gaps") and one-file tunable here.
  HEALTH_WEIGHT_CANCELLED: z.coerce.number().default(50),
  HEALTH_WEIGHT_NO_SUBSCRIPTION: z.coerce.number().default(30),
  HEALTH_WEIGHT_TRIAL: z.coerce.number().default(10),
  HEALTH_WEIGHT_CAP_ALERT: z.coerce.number().default(15),
  HEALTH_WEIGHT_UNINSTALLED: z.coerce.number().default(100),
  HEALTH_WEIGHT_OPEN_CONVERSATION: z.coerce.number().default(5),
  HEALTH_WEIGHT_LOW_CSAT: z.coerce.number().default(20),
  HEALTH_BAND_AT_RISK: z.coerce.number().positive().default(25),
  HEALTH_BAND_CRITICAL: z.coerce.number().positive().default(60),

  // NPS survey window (cp-announcements-nps): a shop is counted once per window so a
  // repeat submission inside it is an idempotent no-op.
  NPS_SURVEY_WINDOW_DAYS: z.coerce.number().int().positive().default(90),

  // Feature-flag read endpoint (cp-feature-flags). Bearer token the SaleSwitch app
  // presents to `/api/flags`. Empty => the endpoint refuses every request (fail-closed)
  // until a token is injected via the secrets seam.
  FEATURE_FLAGS_READ_TOKEN: z.string().default(""),

  // Churn retention reconciliation (cp-uninstall-churn). The redaction itself stays the
  // compliance flow's job; this gates the CP-owned PII purge for a churned shop. Default
  // OFF pending team/legal confirmation (see docs/churn-retention.md).
  CHURN_RETENTION_PURGE_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
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
