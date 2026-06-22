import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from "@casl/ability";
import type { Role } from ".prisma/control-plane";

/**
 * Owned RBAC policy layer (cp-auth-rbac). Enforced SERVER-SIDE in tRPC middleware,
 * independent of any UI gating. The RBAC matrix (PRD §4):
 *
 *            | view | chat reply / notes / tags | non-dangerous action | dangerous action | audit view | manage roles
 *   ADMIN    |  ✓   |            ✓              |          ✓           |        ✓         |     ✓      |      ✓
 *   SUPPORT  |  ✓   |            ✓              |          ✓           |        ✗         |     ✗      |      ✗
 *   VIEWER   |  ✓   |            ✗              |          ✗           |        ✗         |     ✗      |      ✗
 */
export type Action =
  | "view" // read merchants, dashboard, merchant data, billing
  | "reply" // chat reply, add/remove notes & tags
  | "action:nondangerous" // guarded non-dangerous merchant action
  | "action:dangerous" // guarded dangerous merchant action
  | "audit:view" // read the audit log
  | "roles:manage"; // change roles / manage registry

export type Subject = "all";

export type AppAbility = MongoAbility<[Action, Subject]>;

export function defineAbilityFor(role: Role): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // Everyone authenticated can view.
  can("view", "all");

  if (role === "SUPPORT" || role === "ADMIN") {
    can("reply", "all");
    can("action:nondangerous", "all");
  }

  if (role === "ADMIN") {
    can("action:dangerous", "all");
    can("audit:view", "all");
    can("roles:manage", "all");
  }

  return build();
}

/** Convenience predicate used by tRPC middleware + UI gating. */
export function roleCan(role: Role, action: Action): boolean {
  return defineAbilityFor(role).can(action, "all");
}
