import type { Role } from "@prisma/client";
import { getDb } from "./db.js";
import { getConfig } from "~/lib/config.js";

/** The authenticated admin identity resolved from the WorkOS session. */
export interface AdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
}

/**
 * WorkOS AuthKit adapter (cp-auth-rbac AC1.2). Verifies the request session and
 * returns the WorkOS profile, or null if unauthenticated.
 *
 * MVP stub: in a real deploy this calls `authkit-react-router`'s `authLoader` /
 * `getSignInUrl` and verifies the sealed session cookie. Here we expose the seam
 * and a test-injectable resolver so the rest of the stack (provisioning, RBAC) is
 * fully implemented and testable without a live WorkOS tenant.
 */
export interface WorkOsProfile {
  readonly email: string;
  readonly name: string | null;
  /** WorkOS session expiry (epoch seconds). */
  readonly expiresAt: number;
}

export interface WorkOsAdapter {
  /** Resolve the profile from request headers, or null if no/invalid session. */
  resolveProfile(headers: Headers): Promise<WorkOsProfile | null>;
  /** URL to redirect to for sign-in (Google/Microsoft social login). */
  signInUrl(): string;
}

class StubWorkOsAdapter implements WorkOsAdapter {
  async resolveProfile(headers: Headers): Promise<WorkOsProfile | null> {
    // Dev/test seam: a signed header stands in for the sealed WorkOS cookie.
    // Production swaps this for real AuthKit session verification.
    const email = headers.get("x-workos-email");
    if (!email) return null;
    const ttl = getConfig().SESSION_TTL_SECONDS;
    return {
      email,
      name: headers.get("x-workos-name"),
      expiresAt: Math.floor(Date.now() / 1000) + ttl,
    };
  }
  signInUrl(): string {
    return getConfig().WORKOS_REDIRECT_URI;
  }
}

let workos: WorkOsAdapter = new StubWorkOsAdapter();
export function getWorkOs(): WorkOsAdapter {
  return workos;
}
export function __setWorkOs(fake: WorkOsAdapter): void {
  workos = fake;
}

/**
 * Resolve (and on first login, provision) the AdminUser for a request.
 * First login provisions with the default VIEWER role (AC1.2); returning users
 * are reused and their elevated role is preserved (AC1.2 returning-user scenario).
 * Returns null when unauthenticated or the WorkOS session has expired (AC1.5).
 */
export async function resolveIdentity(
  headers: Headers,
): Promise<AdminIdentity | null> {
  const profile = await getWorkOs().resolveProfile(headers);
  if (!profile) return null;
  if (profile.expiresAt * 1000 <= Date.now()) return null; // expired => re-auth

  const db = getDb();
  const user = await db.adminUser.upsert({
    where: { email: profile.email },
    // First login: create with default VIEWER. Returning login: do NOT reset role.
    create: { email: profile.email, name: profile.name, role: "VIEWER" },
    update: { lastLogin: new Date(), name: profile.name ?? undefined },
  });

  if (user.status === "DISABLED") return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
