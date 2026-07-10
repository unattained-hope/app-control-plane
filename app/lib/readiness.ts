import Redis from "ioredis";
import { getConfig } from "./config.js";
import { getDb } from "../server/db.js";

/**
 * Liveness/readiness checks (cp-status-synthetics). `/healthz` is liveness (process
 * up); `/readyz` is readiness — it pings the control-plane DB and Redis so an
 * orchestrator pulls a degraded instance out of rotation. The probes return up/down
 * only — never any data. The probe functions are injectable so the readiness logic is
 * testable without a live DB/Redis.
 */

export interface ReadinessResult {
  readonly ok: boolean;
  readonly db: boolean;
  readonly redis: boolean;
}

export interface ReadinessProbes {
  readonly db: () => Promise<boolean>;
  readonly redis: () => Promise<boolean>;
}

let redisProbe: Redis | null = null;
function redisClient(): Redis {
  if (!redisProbe) {
    redisProbe = new Redis(getConfig().REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      retryStrategy: () => null, // a probe never reconnects in a loop
    });
    redisProbe.on("error", () => {
      /* swallow — checkRedis reports the failure as not-ready */
    });
  }
  return redisProbe;
}

async function defaultDbProbe(): Promise<boolean> {
  try {
    // Control-plane's OWN Postgres (not an app DB) — a trivial liveness query.
    await getDb().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function defaultRedisProbe(): Promise<boolean> {
  try {
    const client = redisClient();
    if (client.status !== "ready" && client.status !== "connecting") {
      await client.connect().catch(() => undefined);
    }
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

export function defaultProbes(): ReadinessProbes {
  return { db: defaultDbProbe, redis: defaultRedisProbe };
}

/** Run both probes; `ok` only when both succeed. */
export async function checkReadiness(
  probes: ReadinessProbes = defaultProbes(),
): Promise<ReadinessResult> {
  const [db, redis] = await Promise.all([probes.db(), probes.redis()]);
  return { ok: db && redis, db, redis };
}

/** Map a readiness result to an HTTP status + JSON body (the readyz route contract). */
export function readinessResponse(result: ReadinessResult): {
  status: number;
  body: ReadinessResult;
} {
  return { status: result.ok ? 200 : 503, body: result };
}
