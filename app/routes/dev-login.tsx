import { redirect, type LoaderFunctionArgs } from "react-router";
import { getConfig } from "~/lib/config.js";
import { devRoleCookie } from "~/server/devSession.js";
import type { Role } from "@prisma/client";

/**
 * DEV-ONLY role switcher: `/dev-login?role=ADMIN&to=/audit` sets the cp_dev_role
 * cookie and redirects. 404s in production (the cookie path is inert there too).
 * Lets Playwright drive VIEWER vs ADMIN through the real RBAC paths.
 */
export function loader({ request }: LoaderFunctionArgs) {
  if (getConfig().NODE_ENV !== "development") {
    throw new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const role = url.searchParams.get("role");
  const to = url.searchParams.get("to") ?? "/";
  if (role !== "ADMIN" && role !== "SUPPORT" && role !== "VIEWER") {
    throw new Response("role must be ADMIN | SUPPORT | VIEWER", { status: 400 });
  }
  return redirect(to, {
    headers: { "Set-Cookie": devRoleCookie(role as Role) },
  });
}
