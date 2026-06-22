import { z } from "zod";
import { router, requireAbility, authedProcedure } from "../core.js";
import { getAppRegistryService } from "../../services/appRegistryService.js";
import { getDb } from "../../db.js";

/**
 * App registry + user/role management router (cp-app-registry-connector, cp-auth-rbac).
 * `apps` (top-bar selector) is available to any authed user; role/registry
 * management is ADMIN-only via the `roles:manage` ability.
 */
export const appRouter_ = router({
  apps: authedProcedure.query(() => getAppRegistryService().listActiveApps()),

  users: requireAbility("roles:manage").query(async () => {
    const users = await getDb().adminUser.findMany({ orderBy: { email: "asc" } });
    return users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status }));
  }),

  changeRole: requireAbility("roles:manage")
    .input(
      z.object({
        targetUserId: z.string(),
        newRole: z.enum(["ADMIN", "SUPPORT", "VIEWER"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      getAppRegistryService().changeRole(ctx.identity, input.targetUserId, input.newRole, {
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }),
    ),
});
