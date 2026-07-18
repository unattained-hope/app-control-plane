import { redirect, type LoaderFunctionArgs } from "react-router";
import { devRoleCookie } from "~/server/devSession.js";
import type { Role } from "@prisma/client";

/**
 * Role login: `/dev-login?role=ADMIN&to=/audit` sets the `cp_dev_role` cookie
 * and redirects. Used locally, in e2e, and on staging (behind Basic Auth).
 */
export function loader({ request }: LoaderFunctionArgs) {
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
