import type { Role } from "@prisma/client";
import { getConfig } from "~/lib/config.js";
import { getDb } from "./db.js";
import type { AdminIdentity } from "./auth.js";

/**
 * DEV-ONLY session shim (gated to NODE_ENV=development). Lets a browser carry an
 * identity + role via a cookie so the real RBAC paths (ADMIN-only audit, VIEWER
 * read-only) can be exercised end-to-end without a live WorkOS tenant.
 *
 * In production this module is inert — `resolveDevIdentity` returns null and the
 * real WorkOS adapter (app/server/auth.ts) is the only identity source.
 */
const COOKIE = "cp_dev_role";
const DEV_EMAIL_BY_ROLE: Record<Role, string> = {
  ADMIN: "admin@apoaap.dev",
  SUPPORT: "support@apoaap.dev",
  VIEWER: "viewer@apoaap.dev",
};

function isDev(): boolean {
  return getConfig().NODE_ENV === "development";
}

function parseRole(value: string | undefined): Role | null {
  if (value === "ADMIN" || value === "SUPPORT" || value === "VIEWER") return value;
  return null;
}

/** Read the dev role from the Cookie header, if present and valid. */
export function readDevRole(headers: Headers): Role | null {
  if (!isDev()) return null;
  const cookie = headers.get("cookie") ?? "";
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  return parseRole(decodeURIComponent(match.slice(COOKIE.length + 1)));
}

/**
 * Resolve (and provision) a dev AdminUser for the cookie role. Returns null when
 * not in dev or no dev cookie is set, so the normal auth path takes over.
 */
export async function resolveDevIdentity(headers: Headers): Promise<AdminIdentity | null> {
  const role = readDevRole(headers);
  if (!role) return null;
  const email = DEV_EMAIL_BY_ROLE[role];
  const db = getDb();
  const user = await db.adminUser.upsert({
    where: { email },
    create: { email, name: `Dev ${role}`, role },
    // Keep the dev user's role in sync with the selected cookie role.
    update: { role, lastLogin: new Date() },
  });
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Build a Set-Cookie value selecting a dev role (used by the dev sign-in route). */
export function devRoleCookie(role: Role): string {
  return `${COOKIE}=${role}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

export const DEV_ROLES: readonly Role[] = ["ADMIN", "SUPPORT", "VIEWER"];
