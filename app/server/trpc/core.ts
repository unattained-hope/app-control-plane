import { initTRPC, TRPCError } from "@trpc/server";
import type { AdminIdentity } from "../auth.js";
import { defineAbilityFor, type Action } from "../rbac.js";

/** Request-scoped tRPC context. */
export interface Context {
  readonly identity: AdminIdentity | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** The currently-selected app key (from the top-bar selector). MVP: "saleswitch". */
  readonly appKey: string;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Reject unauthenticated requests at the APP layer (cp-auth-rbac AC1.1) — in
 * addition to the zero-trust gateway. No procedure side effect runs without a
 * valid session.
 */
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.identity) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, identity: ctx.identity } });
});

/**
 * Build a procedure that enforces a CASL ability SERVER-SIDE (AC1.3). A role
 * lacking the ability gets FORBIDDEN before any side effect runs. UI gating is
 * cosmetic only.
 */
export function requireAbility(action: Action) {
  return authedProcedure.use(({ ctx, next }) => {
    const ability = defineAbilityFor(ctx.identity.role);
    if (!ability.can(action, "all")) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next({ ctx });
  });
}
