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

  // Badge graphic gallery (cp-app-settings). Local asset storage for uploaded
  // badge images; the merchant read API is token-guarded like feature flags.
  BADGE_GRAPHIC_STORAGE_DIR: z.string().default("./data/badge-graphics"),
  /** Max stored AVIF size per badge graphic (cp-app-settings). */
  BADGE_GRAPHIC_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024),
  BADGE_GRAPHIC_READ_TOKEN: z.string().default(""),
  /**
   * Optional read-only fallback directory (local dev). When a file is missing from
   * BADGE_GRAPHIC_STORAGE_DIR, serve from here instead — typically the sibling Badgy
   * repo: ../badgy/public/images/badge-graphics
   */
  BADGE_GRAPHIC_FALLBACK_DIR: z.string().default(""),
  /**
   * Public base URL of this control plane (no trailing slash). When set, `/api/badge-graphics`
   * returns absolute asset URLs so Badgy on another host can load images.
   */
  BADGE_GRAPHIC_PUBLIC_BASE_URL: z.string().default(""),

  // --- Usage-event ingestion (usage-analytics Phase 2b) ---

  // Base URL of the SaleSwitch/Badgy internal API the usageIngest worker polls,
  // e.g. https://saleswitch.example.com (no trailing slash; path appended). Empty
  // => ingestion is disabled (the worker skips SaleSwitch, no outbound calls).
  SALESWITCH_INTERNAL_API_URL: z.string().default(""),
  // HMAC shared secret for signing internal-API requests to Badgy. MUST equal
  // Badgy's BADGY_INTERNAL_API_SECRET. Resolved via the secrets seam
  // (secret:saleswitch/internal-api). Empty => ingestion is disabled (fail-closed).
  SALESWITCH_INTERNAL_API_SECRET: z.string().default(""),
  // Poll cadence for the usage-event pull. ~1 min is plenty for product analytics.
  USAGE_INGEST_CRON: z.string().default("*/1 * * * *"),
  // Page size requested from the events endpoint. Kept modest (well under the
  // endpoint's 1000 cap) — the drain loop compensates with more pages. The client
  // tolerates whatever cap the endpoint enforces regardless.
  USAGE_INGEST_PAGE_SIZE: z.coerce.number().int().positive().default(200),
  // Safety bound so one run can't drain an unbounded backlog; the remainder is
  // picked up on the next tick.
  USAGE_INGEST_MAX_PAGES_PER_RUN: z.coerce.number().int().positive().default(50),
  // Retention window for the mirror table (matches Badgy's source retention).
  // Aggregates (Phase 3) are permanent, so pruning the mirror loses nothing.
  USAGE_MIRROR_RETENTION_MONTHS: z.coerce.number().int().positive().default(18),
  // Ingestion-lag alert threshold: raise an alert when the newest mirrored event
  // is older than this while the app is still emitting.
  USAGE_INGEST_LAG_ALERT_MINUTES: z.coerce.number().int().positive().default(15),

  // --- Usage-metric rollups + cohort assignment (usage-analytics Phase 3) ---

  // Rollup cadence (cron). The INCREMENTAL job refreshes TODAY (UTC) frequently so
  // dashboards are same-day fresh; the FINALIZE job recomputes YESTERDAY fully once
  // the morning after, correcting for ingestion lag; the COHORT job assigns nightly
  // per-shop cohort snapshots. Following GROWTH_ROLLUP_CRON's z.string().default(...).
  USAGE_ROLLUP_INCREMENTAL_CRON: z.string().default("0 * * * *"), // hourly, top of hour
  USAGE_ROLLUP_FINALIZE_CRON: z.string().default("30 0 * * *"), // 00:30 UTC daily
  USAGE_COHORT_CRON: z.string().default("0 2 * * *"), // 02:00 UTC nightly

  // Usage-intensity scoring weights (cp usage-cohort-assignment). The 30-day activity
  // score is a transparent weighted SUM of behavioral counts (higher = more intense);
  // shops are then bucketed by percentile (below). Mirrors HEALTH_WEIGHT_* — one-file
  // tunable, z.coerce.number().default(...). Defaults per design.md Decision 5.
  USAGE_INTENSITY_WEIGHT_CAMPAIGN_ACTIVATED: z.coerce.number().default(5),
  USAGE_INTENSITY_WEIGHT_WIZARD_SESSION: z.coerce.number().default(2),
  USAGE_INTENSITY_WEIGHT_TEMPLATE_EDIT: z.coerce.number().default(1),
  USAGE_INTENSITY_WEIGHT_ACTIVE_DAY: z.coerce.number().default(1),

  // Intensity percentile cut-points (0–1). A shop at/above the POWER percentile of the
  // day's non-zero-score population is POWER; at/above REGULAR is REGULAR; the rest
  // (still non-zero) are LIGHT; a zero score is INACTIVE. Open question in design.md —
  // ship with defaults, revisit after two weeks of real data.
  USAGE_INTENSITY_PERCENTILE_POWER: z.coerce.number().min(0).max(1).default(0.9),
  USAGE_INTENSITY_PERCENTILE_REGULAR: z.coerce.number().min(0).max(1).default(0.5),

  // Feature-persona rule thresholds (cp usage-cohort-assignment). A persona tag is
  // assigned when the shop's trailing-30-day feature-usage count meets its threshold.
  // Rule set + defaults per the spec (AUTOMATION_USER = recurrence or Flow ≥2, etc.).
  USAGE_PERSONA_DISCOUNT_ORCHESTRATOR_MIN: z.coerce.number().int().default(3),
  USAGE_PERSONA_BADGE_DESIGNER_MIN: z.coerce.number().int().default(3),
  USAGE_PERSONA_BANNER_BROADCASTER_MIN: z.coerce.number().int().default(3),
  USAGE_PERSONA_AUTOMATION_USER_MIN: z.coerce.number().int().default(2),
  // MINIMALIST = active but uses at most this many distinct features (low breadth).
  USAGE_PERSONA_MINIMALIST_MAX_FEATURES: z.coerce.number().int().default(1),

  // Retention: how many install-cohort weeks the matrix spans (week offsets 0..N-1).
  USAGE_RETENTION_MAX_WEEKS: z.coerce.number().int().positive().default(12),
  // Feature-adoption "top validation rules" cap surfaced per day.
  USAGE_FUNNEL_TOP_RULES: z.coerce.number().int().positive().default(10),

  // --- Usage dashboards (usage-analytics Phase 4) ---

  // HARD page cap for the per-merchant Activity feed — the ONE bounded raw-event read
  // the dashboards may issue (design.md Decision 2). The feed is cursor-paginated; a
  // request may ask for fewer, never more, than this many events per page. Keeps the
  // one raw read demonstrably bounded so it can never be mistaken for a chart source.
  USAGE_ACTIVITY_FEED_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(50),

  // --- Usage alerts + weekly digest (usage-analytics Phase 5) ---

  // Alert-rule DEFAULT thresholds seeded into `UsageAlertRule` (all seeded DISABLED —
  // enabled individually from the ADMIN UI once two weeks of Phase 3/4 data justify the
  // number). Following the HEALTH_WEIGHT_* / USAGE_INTENSITY_* one-file-tunable idiom.
  //   - funnel completion drop (points, 0–1): wizard-completed conversion falling more
  //     than this week-over-week is a regression worth a page.
  USAGE_ALERT_FUNNEL_DROP_POINTS: z.coerce.number().min(0).max(1).default(0.1),
  //   - DORMANT spike (fraction): DORMANT-entry count rising more than this WoW.
  USAGE_ALERT_DORMANT_RISE_PERCENT: z.coerce.number().min(0).default(0.25),
  //   - WAU drop (fraction): weekly-active-shops falling more than this WoW.
  USAGE_ALERT_WAU_DROP_PERCENT: z.coerce.number().min(0).default(0.2),

  // Weekly usage digest (cp usage-alerts-digest). Recipients (comma-separated) + the
  // send schedule. Empty recipients => the digest composes but does not "send" (the
  // Sentry/notification path still records it) — matches the SENTRY_DSN-empty fallback.
  USAGE_DIGEST_CRON: z.string().default("0 13 * * 1"), // Mondays 13:00 UTC
  USAGE_DIGEST_RECIPIENTS: z.string().default(""),
  // The alert-evaluation job runs AFTER the daily finalize (finalized numbers only);
  // its own cron is a safety net if the chained trigger is ever disabled. Defaults to
  // just after the finalize cron (00:30) so it never races provisional intraday data.
  USAGE_ALERT_EVAL_CRON: z.string().default("45 0 * * *"), // 00:45 UTC daily

  // Per-admin cap on saved explorer views (cp usage-saved-views). Enforced server-side
  // in the tRPC create path; keeps one admin from hoarding unbounded presets.
  USAGE_SAVED_VIEW_MAX_PER_USER: z.coerce.number().int().positive().default(50),
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

/**
 * Test-only seam: drop the memoised config so the NEXT `getConfig()` re-reads
 * `process.env`. Vitest isolates each test FILE but the module-level `cached` can be
 * populated (by an earlier test's config-dependent code) before a later `beforeAll`
 * sets its env — leaking a stale value across tests. Calling this from `stubValidEnv`
 * (invoked in every suite's `beforeAll`) makes each file see its own env. Never call in
 * production code.
 */
export function __resetConfigForTests(): void {
  cached = null;
}

/** Whether the SaleSwitch admin API (D2) is configured. Gates app-backed actions. */
export function isAppAdminApiConfigured(cfg: AppConfig = getConfig()): boolean {
  return Boolean(cfg.SALESWITCH_ADMIN_API_URL && cfg.SALESWITCH_ADMIN_API_TOKEN);
}
