import type { Role } from "@prisma/client";
import { getDb } from "./db.js";

/** The authenticated admin identity for a request. */
export interface AdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
}

/**
 * Optional header seam for tests / automation (`x-admin-email`, optional
 * `x-admin-name`). Browser sessions use the role cookie via `devSession.ts`.
 */
export async function resolveIdentity(
  headers: Headers,
): Promise<AdminIdentity | null> {
  const email = headers.get("x-admin-email");
  if (!email) return null;

  const name = headers.get("x-admin-name");
  const db = getDb();
  const user = await db.adminUser.upsert({
    where: { email },
    create: { email, name, role: "VIEWER" },
    update: { lastLogin: new Date(), name: name ?? undefined },
  });

  if (user.status === "DISABLED") return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
