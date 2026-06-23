import type { AdminIdentity } from "../auth.js";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import type { Role } from "@prisma/client";

/**
 * App registry + user/role management (cp-app-registry-connector, cp-auth-rbac).
 * The registry drives the top-bar selector (active apps only). Role changes are
 * ADMIN-only (enforced in the router) and audited atomically with the change.
 */
export interface AppSummary {
  readonly key: string;
  readonly name: string;
  readonly enabledModules: readonly string[];
}

export class AppRegistryService {
  private readonly db = getDb();
  private readonly audit = getAuditService();

  /** Active registered apps for the top-bar selector (excludes DISABLED). */
  async listActiveApps(): Promise<AppSummary[]> {
    const apps = await this.db.app.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
    });
    return apps.map((a) => ({
      key: a.key,
      name: a.name,
      enabledModules: a.enabledModules,
    }));
  }

  /**
   * Change another user's role. Persists the new role and writes the audit row in
   * the SAME transaction (cp-audit-log atomicity / AC1.4). The actor must be ADMIN
   * (router-enforced).
   */
  async changeRole(
    actor: AdminIdentity,
    targetUserId: string,
    newRole: Role,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const target = await tx.adminUser.findUnique({ where: { id: targetUserId } });
      if (!target) throw new Error("Target user not found");
      const before = target.role;
      await tx.adminUser.update({ where: { id: targetUserId }, data: { role: newRole } });
      await this.audit.append(
        {
          actorUserId: actor.id,
          appKey: "_platform",
          action: "user.role.change",
          target: targetUserId,
          before: { role: before },
          after: { role: newRole },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
    });
  }
}

let instance: AppRegistryService | null = null;
export function getAppRegistryService(): AppRegistryService {
  if (!instance) instance = new AppRegistryService();
  return instance;
}
