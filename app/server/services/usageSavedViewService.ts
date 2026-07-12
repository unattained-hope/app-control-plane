// app/server/services/usageSavedViewService.ts
// Per-admin saved views for the usage shop explorer (cp usage-saved-views, Phase 5). A
// thin owner-scoped CRUD over `UsageSavedView`: each admin sees + manages ONLY their own
// presets (scoped by `adminUserId`, resolved from the tRPC context — never the request
// body), capped per user. `params` is opaque explorer state (filters/axes/color-by) the
// server round-trips verbatim; the UI owns its shape. No sharing/team presets, and no
// audit — these are private per-user preferences, not merchant actions or admin writes,
// so the same-transaction-audit invariant (which covers merchant/role/PII effects) does
// not apply here.

import type { Prisma, UsageSavedView } from "@prisma/client";
import { getDb } from "../db.js";
import { getConfig } from "~/lib/config.js";

export class UsageSavedViewNotFoundError extends Error {
  readonly code = "USAGE_SAVED_VIEW_NOT_FOUND";
  constructor(id: string) {
    super(`Saved view "${id}" not found.`);
  }
}

export class UsageSavedViewNameConflictError extends Error {
  readonly code = "USAGE_SAVED_VIEW_NAME_CONFLICT";
  constructor(name: string) {
    super(`A saved view named "${name}" already exists.`);
  }
}

export class UsageSavedViewCapExceededError extends Error {
  readonly code = "USAGE_SAVED_VIEW_CAP_EXCEEDED";
  constructor(cap: number) {
    super(`You have reached the saved-view limit (${cap}). Delete one to add another.`);
  }
}

export interface SaveViewInput {
  readonly name: string;
  /** Opaque explorer state — validated as JSON-serializable at the router boundary. */
  readonly params: unknown;
}

/** Narrow the router-validated JSON blob to Prisma's input type at the DB boundary. */
function asJson(params: unknown): Prisma.InputJsonValue {
  return params as Prisma.InputJsonValue;
}

export class UsageSavedViewService {
  constructor(private readonly db = getDb()) {}

  /** The acting admin's own views (newest-updated first). Owner-scoped by `adminUserId`. */
  async list(appKey: string, adminUserId: string): Promise<UsageSavedView[]> {
    return this.db.usageSavedView.findMany({
      where: { appKey, adminUserId },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * Create a new named preset for the acting admin. Enforces the per-user cap and a
   * unique name within the admin's own set. Both `appKey` and `adminUserId` come from
   * the caller's context, never from client input.
   */
  async create(
    appKey: string,
    adminUserId: string,
    input: SaveViewInput,
  ): Promise<UsageSavedView> {
    const cap = getConfig().USAGE_SAVED_VIEW_MAX_PER_USER;
    const owned = await this.db.usageSavedView.findMany({
      where: { appKey, adminUserId },
    });
    if (owned.length >= cap) throw new UsageSavedViewCapExceededError(cap);
    if (owned.some((v) => v.name === input.name)) {
      throw new UsageSavedViewNameConflictError(input.name);
    }
    return this.db.usageSavedView.create({
      data: { appKey, adminUserId, name: input.name, params: asJson(input.params) },
    });
  }

  /** Rename and/or replace the params of one of the acting admin's OWN views. */
  async update(
    appKey: string,
    adminUserId: string,
    id: string,
    patch: { name?: string; params?: unknown },
  ): Promise<UsageSavedView> {
    const existing = await this.ownedOrThrow(appKey, adminUserId, id);
    if (patch.name !== undefined && patch.name !== existing.name) {
      const clash = await this.db.usageSavedView.findFirst({
        where: { appKey, adminUserId, name: patch.name },
      });
      if (clash) throw new UsageSavedViewNameConflictError(patch.name);
    }
    return this.db.usageSavedView.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.params !== undefined ? { params: asJson(patch.params) } : {}),
      },
    });
  }

  /** Delete one of the acting admin's OWN views. */
  async remove(appKey: string, adminUserId: string, id: string): Promise<void> {
    await this.ownedOrThrow(appKey, adminUserId, id);
    await this.db.usageSavedView.delete({ where: { id } });
  }

  /**
   * Resolve a view by id, asserting it belongs to the acting admin+app. Scoping the
   * lookup by `adminUserId` is what makes another admin's id return NOT_FOUND rather than
   * exposing/mutating a view they don't own.
   */
  private async ownedOrThrow(
    appKey: string,
    adminUserId: string,
    id: string,
  ): Promise<UsageSavedView> {
    const row = await this.db.usageSavedView.findFirst({
      where: { id, appKey, adminUserId },
    });
    if (!row) throw new UsageSavedViewNotFoundError(id);
    return row;
  }
}

let instance: UsageSavedViewService | null = null;
export function getUsageSavedViewService(): UsageSavedViewService {
  if (!instance) instance = new UsageSavedViewService();
  return instance;
}
