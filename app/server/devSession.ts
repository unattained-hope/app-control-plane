import type { Role } from "@prisma/client";
import { getDb } from "./db.js";
import type { AdminIdentity } from "./auth.js";

/**
 * Cookie-backed admin session. Sets a role via `/dev-login` so operators (and
 * Playwright) can exercise ADMIN / SUPPORT / VIEWER without an SSO provider.
 * Staging sits behind Caddy Basic Auth; this cookie is the in-app identity only.
 */
const COOKIE = "cp_dev_role";
const EMAIL_BY_ROLE: Record<Role, string> = {
  ADMIN: "admin@apoaap.dev",
  SUPPORT: "support@apoaap.dev",
  VIEWER: "viewer@apoaap.dev",
};

function parseRole(value: string | undefined): Role | null {
  if (value === "ADMIN" || value === "SUPPORT" || value === "VIEWER") return value;
  return null;
}

/** Read the session role from the Cookie header, if present and valid. */
export function readDevRole(headers: Headers): Role | null {
  const cookie = headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  return parseRole(decodeURIComponent(match.slice(COOKIE.length + 1)));
}

/**
 * Resolve (and provision) an AdminUser for the cookie role. Returns null when
 * no session cookie is set.
 */
export async function resolveDevIdentity(
  headers: Headers,
): Promise<AdminIdentity | null> {
  const role = readDevRole(headers);
  if (!role) return null;
  const email = EMAIL_BY_ROLE[role];
  const db = getDb();
  const user = await db.adminUser.upsert({
    where: { email },
    create: { email, name: `Dev ${role}`, role },
    update: { role, lastLogin: new Date() },
  });
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Build a Set-Cookie value selecting a role (used by `/dev-login`). */
export function devRoleCookie(role: Role): string {
  return `${COOKIE}=${role}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

export const DEV_ROLES: readonly Role[] = ["ADMIN", "SUPPORT", "VIEWER"];
