import { authLoader } from "@workos-inc/authkit-react-router";
import { ensureAuthKitConfigured } from "~/server/auth.js";

/**
 * WorkOS AuthKit OAuth callback (cp-auth-rbac AC1.2).
 * Must match WORKOS_REDIRECT_URI and the redirect URI in the WorkOS dashboard
 * (staging: https://staging.admin.apoaap.shop/auth/callback).
 */
ensureAuthKitConfigured();

export const loader = authLoader({ returnPathname: "/" });
