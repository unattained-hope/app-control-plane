import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stubValidEnv } from "./helpers/env.js";

beforeAll(() => stubValidEnv());

const { checkReadiness, readinessResponse } = await import("~/lib/readiness.js");

/** cp-status-synthetics — liveness/readiness probes + a synthetic script. */
describe("readiness probes", () => {
  it("is ready only when both dependencies are reachable", async () => {
    const ok = await checkReadiness({ db: async () => true, redis: async () => true });
    expect(ok).toEqual({ ok: true, db: true, redis: true });

    const down = await checkReadiness({ db: async () => true, redis: async () => false });
    expect(down.ok).toBe(false);
  });

  it("maps a not-ready result to HTTP 503 (and ready to 200)", () => {
    expect(readinessResponse({ ok: false, db: true, redis: false }).status).toBe(503);
    expect(readinessResponse({ ok: true, db: true, redis: true }).status).toBe(200);
  });

  it("liveness returns 200", async () => {
    const { loader } = await import("~/routes/healthz.js");
    const res = loader() as Response;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("ships a synthetic transaction script", () => {
    const path = fileURLToPath(
      new URL("../e2e/synthetics/merchant-journey.spec.ts", import.meta.url),
    );
    expect(existsSync(path)).toBe(true);
  });
});
