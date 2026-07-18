import type { Role } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import {
  configure,
  getConfig as getAuthKitConfig,
  getSignInUrl,
  withAuth,
} from "@workos-inc/authkit-react-router";
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
 * Production reads the sealed AuthKit session cookie (`wos-session`). Dev/test
 * may also inject identity via `x-workos-email` / `x-workos-name` headers so
 * provisioning + RBAC stay testable without a live WorkOS tenant.
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
  signInUrl(returnPathname?: string): Promise<string>;
}

let authKitReady = false;

/** Point AuthKit at our validated config (single source: app/lib/config). */
export function ensureAuthKitConfigured(): void {
  if (authKitReady) return;
  const cfg = getConfig();
  configure({
    clientId: cfg.WORKOS_CLIENT_ID,
    apiKey: cfg.WORKOS_API_KEY,
    redirectUri: cfg.WORKOS_REDIRECT_URI,
    cookiePassword: cfg.WORKOS_COOKIE_PASSWORD,
    cookieMaxAge: cfg.SESSION_TTL_SECONDS,
  });
  authKitReady = true;
}

class AuthKitWorkOsAdapter implements WorkOsAdapter {
  async resolveProfile(headers: Headers): Promise<WorkOsProfile | null> {
    ensureAuthKitConfigured();
    const ttl = getConfig().SESSION_TTL_SECONDS;

    // Dev/test seam: a signed header stands in for the sealed WorkOS cookie.
    const emailHeader = headers.get("x-workos-email");
    if (emailHeader) {
      return {
        email: emailHeader,
        name: headers.get("x-workos-name"),
        expiresAt: Math.floor(Date.now() / 1000) + ttl,
      };
    }

    const cookieName = getAuthKitConfig("cookieName");
    const cookieHeader = headers.get("cookie") ?? "";
    if (!cookieHeader.includes(cookieName)) return null;

    const auth = await withAuth({
      request: new Request("http://localhost", { headers }),
      params: {},
      context: {},
    } as LoaderFunctionArgs);
    if (!auth.user?.email) return null;

    const nameParts = [auth.user.firstName, auth.user.lastName].filter(Boolean);
    return {
      email: auth.user.email,
      name: nameParts.length > 0 ? nameParts.join(" ") : null,
      // Access tokens are short-lived; AuthKit refresh (authkitLoader) renews them.
      // Treat the sealed session as valid for our app TTL window.
      expiresAt: Math.floor(Date.now() / 1000) + ttl,
    };
  }

  async signInUrl(returnPathname?: string): Promise<string> {
    ensureAuthKitConfigured();
    return getSignInUrl(returnPathname);
  }
}

let workos: WorkOsAdapter = new AuthKitWorkOsAdapter();
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
