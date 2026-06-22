#!/usr/bin/env node
/**
 * Architecture lint guard (cp-platform-infrastructure AC9.4, cp-app-registry-connector).
 *
 * Enforces two structural invariants by static scan:
 *   1. `process.env` is read ONLY in app/lib/config.ts.
 *   2. No raw SQL ($queryRaw/$executeRaw) in connector code — it defaults to the
 *      primary and bypasses replica routing.
 *
 * Exits non-zero on violation so CI fails before deploy.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = join(ROOT, "app");

const CONFIG_FILE = join("app", "lib", "config.ts");

/** @type {string[]} */
const violations = [];

/** @param {string} dir */
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(ROOT, full);
    const src = readFileSync(full, "utf8");

    // 1. process.env only in config.ts
    if (rel !== CONFIG_FILE && /process\.env/.test(src)) {
      violations.push(`${rel}: reads process.env outside app/lib/config.ts`);
    }

    // 2. no raw SQL in connectors
    if (rel.includes(join("server", "connectors")) && /\$(queryRaw|executeRaw)/.test(src)) {
      violations.push(`${rel}: raw SQL in connector bypasses replica routing`);
    }
  }
}

walk(APP);

if (violations.length > 0) {
  console.error("Architecture guard FAILED:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("Architecture guard passed.");
