import type { BadgeGraphic, Prisma } from "@prisma/client";
import { Prisma as PrismaClient } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService, type AuditService, type TxClient } from "./auditService.js";
import { deleteBadgeGraphicFile } from "./badgeGraphicStorage.js";
import { AuditActions } from "~/lib/auditActions.js";
import type { BadgeGraphicDto } from "~/lib/badgeGraphicTypes.js";
import { DEFAULT_IMAGE_BADGE_GRAPHIC_SLUG } from "~/lib/badgeGraphicDefaults.js";
import {
  stripBadgeGraphicAssetQuery,
  withBadgeGraphicCacheBust,
} from "~/lib/badgeGraphicUrls.js";

/**
 * Badge graphic gallery registry (cp-app-settings). Portfolio-wide IMAGE badge
 * presets the SaleSwitch app reads via `/api/badge-graphics`. Mutations are
 * `settings:manage` (ADMIN, router-enforced) and audited in the same transaction.
 */

export class BadgeGraphicNotFoundError extends Error {
  readonly code = "BADGE_GRAPHIC_NOT_FOUND";
  constructor(id: string) {
    super(`Badge graphic "${id}" not found.`);
  }
}

export class BadgeGraphicSlugConflictError extends Error {
  readonly code = "BADGE_GRAPHIC_SLUG_CONFLICT";
  constructor(slug: string) {
    super(`Badge graphic slug "${slug}" already exists for this app.`);
  }
}

export class BadgeGraphicDefaultNotFoundError extends Error {
  readonly code = "BADGE_GRAPHIC_DEFAULT_NOT_FOUND";
  constructor(slug: string) {
    super(`Active badge graphic "${slug}" was not found for this app.`);
  }
}

export interface BadgeGraphicActor {
  readonly id: string;
  readonly email?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface CreateBadgeGraphicInput {
  readonly slug: string;
  readonly label: string;
  readonly imagePath: string;
  readonly textBaked: boolean;
  readonly theme: string;
  readonly graphicType: string;
  readonly sortOrder?: number;
}

export interface UpdateBadgeGraphicInput {
  readonly label?: string;
  readonly imagePath?: string;
  readonly textBaked?: boolean;
  readonly theme?: string;
  readonly graphicType?: string;
  readonly sortOrder?: number;
}

export interface ListBadgeGraphicsFilters {
  readonly theme?: string;
  readonly graphicType?: string;
  readonly search?: string;
  readonly includeArchived?: boolean;
}

function toDto(row: BadgeGraphic): BadgeGraphicDto {
  const imagePath = stripBadgeGraphicAssetQuery(row.imagePath);
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    imagePath: withBadgeGraphicCacheBust(imagePath, row.updatedAt.getTime()),
    textBaked: row.textBaked,
    theme: row.theme as BadgeGraphicDto["theme"],
    graphicType: row.graphicType as BadgeGraphicDto["graphicType"],
    sortOrder: row.sortOrder,
    status: row.status as BadgeGraphicDto["status"],
  };
}

function normalizeStoredImagePath(imagePath: string): string {
  return stripBadgeGraphicAssetQuery(imagePath);
}

/** True when the loaded Prisma client includes App.defaultBadgeGraphicSlug (post-generate). */
function appModelSupportsDefaultBadgeSlug(): boolean {
  return (
    PrismaClient.dmmf.datamodel.models
      .find((m) => m.name === "App")
      ?.fields.some((f) => f.name === "defaultBadgeGraphicSlug") ?? false
  );
}

type AppDefaultDb = {
  app: TxClient["app"];
  $queryRaw: TxClient["$queryRaw"];
  $executeRaw: TxClient["$executeRaw"];
};

async function readAppDefaultBadgeSlug(db: AppDefaultDb, appKey: string): Promise<string | null> {
  if (appModelSupportsDefaultBadgeSlug()) {
    const app = await db.app.findFirst({
      where: { key: appKey },
      select: { defaultBadgeGraphicSlug: true },
    });
    return app?.defaultBadgeGraphicSlug?.trim() ?? null;
  }
  const rows = await db.$queryRaw<Array<{ defaultBadgeGraphicSlug: string | null }>>`
    SELECT "defaultBadgeGraphicSlug" FROM apps WHERE key = ${appKey} LIMIT 1
  `;
  return rows[0]?.defaultBadgeGraphicSlug?.trim() ?? null;
}

async function writeAppDefaultBadgeSlug(
  db: AppDefaultDb,
  appKey: string,
  slug: string | null,
): Promise<void> {
  if (appModelSupportsDefaultBadgeSlug()) {
    const app = await db.app.findFirst({ where: { key: appKey } });
    if (!app) throw new Error(`App "${appKey}" not found.`);
    await db.app.update({
      where: { id: app.id },
      data: { defaultBadgeGraphicSlug: slug },
    });
    return;
  }
  await db.$executeRaw`
    UPDATE apps
    SET "defaultBadgeGraphicSlug" = ${slug}, "updatedAt" = NOW()
    WHERE key = ${appKey}
  `;
}

async function clearAppDefaultBadgeSlugIfMatches(
  db: AppDefaultDb,
  appKey: string,
  slug: string,
): Promise<void> {
  if (appModelSupportsDefaultBadgeSlug()) {
    const app = await db.app.findFirst({ where: { key: appKey } });
    if (!app || app.defaultBadgeGraphicSlug !== slug) return;
    await db.app.update({
      where: { id: app.id },
      data: { defaultBadgeGraphicSlug: null },
    });
    return;
  }
  await db.$executeRaw`
    UPDATE apps
    SET "defaultBadgeGraphicSlug" = NULL, "updatedAt" = NOW()
    WHERE key = ${appKey} AND "defaultBadgeGraphicSlug" = ${slug}
  `;
}

export class BadgeGraphicService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
  ) {}

  async list(appKey: string, filters: ListBadgeGraphicsFilters = {}): Promise<BadgeGraphicDto[]> {
    const where: Prisma.BadgeGraphicWhereInput = {
      appKey,
      ...(filters.includeArchived ? {} : { status: "ACTIVE" }),
      ...(filters.theme ? { theme: filters.theme } : {}),
      ...(filters.graphicType ? { graphicType: filters.graphicType } : {}),
      ...(filters.search
        ? {
            OR: [
              { label: { contains: filters.search, mode: "insensitive" } },
              { slug: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const rows = await this.db.badgeGraphic.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
    return rows.map(toDto);
  }

  /** Active graphics for the merchant read API (Badgy gallery feed). */
  async listActiveForApp(appKey: string): Promise<BadgeGraphicDto[]> {
    return this.list(appKey, { includeArchived: false });
  }

  /** Active default graphic row for admin preview (falls back when unset/invalid). */
  async getDefaultGraphic(appKey: string): Promise<BadgeGraphicDto | null> {
    const slug = await this.getDefaultSlug(appKey);
    const row = await this.db.badgeGraphic.findFirst({
      where: { appKey, slug, status: "ACTIVE" },
    });
    return row ? toDto(row) : null;
  }

  /** Default IMAGE badge slug for first-time merchant selection (falls back when unset/invalid). */
  async getDefaultSlug(appKey: string): Promise<string> {
    const configured = await readAppDefaultBadgeSlug(this.db, appKey);
    if (configured) {
      const active = await this.db.badgeGraphic.findFirst({
        where: { appKey, slug: configured, status: "ACTIVE" },
      });
      if (active) return configured;
    }
    const fallback = await this.db.badgeGraphic.findFirst({
      where: { appKey, slug: DEFAULT_IMAGE_BADGE_GRAPHIC_SLUG, status: "ACTIVE" },
    });
    if (fallback) return DEFAULT_IMAGE_BADGE_GRAPHIC_SLUG;
    const first = await this.db.badgeGraphic.findFirst({
      where: { appKey, status: "ACTIVE" },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
    return first?.slug ?? DEFAULT_IMAGE_BADGE_GRAPHIC_SLUG;
  }

  async setDefaultSlug(
    actor: BadgeGraphicActor,
    appKey: string,
    slug: string,
  ): Promise<{ defaultSlug: string }> {
    const graphic = await this.db.badgeGraphic.findFirst({
      where: { appKey, slug, status: "ACTIVE" },
    });
    if (!graphic) throw new BadgeGraphicDefaultNotFoundError(slug);

    return this.db.$transaction(async (tx) => {
      const app = await tx.app.findFirst({
        where: { key: appKey },
        select: { id: true },
      });
      if (!app) throw new Error(`App "${appKey}" not found.`);
      const before = await readAppDefaultBadgeSlug(tx, appKey);
      await writeAppDefaultBadgeSlug(tx, appKey, slug);
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.BadgeGraphicSetDefault,
        app.id,
        { defaultBadgeGraphicSlug: before },
        { defaultBadgeGraphicSlug: slug },
      );
      return { defaultSlug: slug };
    });
  }

  private async clearDefaultSlugIfMatches(
    tx: TxClient,
    appKey: string,
    slug: string,
  ): Promise<void> {
    await clearAppDefaultBadgeSlugIfMatches(tx, appKey, slug);
  }

  async create(
    actor: BadgeGraphicActor,
    appKey: string,
    input: CreateBadgeGraphicInput,
  ): Promise<BadgeGraphicDto> {
    try {
      return await this.db.$transaction(async (tx) => {
        const row = await tx.badgeGraphic.create({
          data: {
            appKey,
            slug: input.slug,
            label: input.label,
            imagePath: normalizeStoredImagePath(input.imagePath),
            textBaked: input.textBaked,
            theme: input.theme,
            graphicType: input.graphicType,
            sortOrder: input.sortOrder ?? 0,
            status: "ACTIVE",
          },
        });
        await this.appendAudit(
          tx,
          actor,
          appKey,
          AuditActions.BadgeGraphicCreate,
          row.id,
          null,
          { slug: row.slug, label: row.label },
        );
        return toDto(row);
      });
    } catch (err) {
      if (
        err instanceof PrismaClient.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new BadgeGraphicSlugConflictError(input.slug);
      }
      throw err;
    }
  }

  async update(
    actor: BadgeGraphicActor,
    appKey: string,
    id: string,
    patch: UpdateBadgeGraphicInput,
  ): Promise<BadgeGraphicDto> {
    const previousImagePath = await this.db.badgeGraphic
      .findFirst({ where: { id, appKey }, select: { imagePath: true } })
      .then((row) => (row?.imagePath ? normalizeStoredImagePath(row.imagePath) : null));

    const normalizedImagePath =
      patch.imagePath !== undefined ? normalizeStoredImagePath(patch.imagePath) : undefined;

    const updated = await this.db.$transaction(async (tx) => {
      const before = await tx.badgeGraphic.findFirst({ where: { id, appKey } });
      if (!before) throw new BadgeGraphicNotFoundError(id);
      const row = await tx.badgeGraphic.update({
        where: { id },
        data: {
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(normalizedImagePath !== undefined ? { imagePath: normalizedImagePath } : {}),
          ...(normalizedImagePath !== undefined ? { updatedAt: new Date() } : {}),
          ...(patch.textBaked !== undefined ? { textBaked: patch.textBaked } : {}),
          ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
          ...(patch.graphicType !== undefined ? { graphicType: patch.graphicType } : {}),
          ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        },
      });
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.BadgeGraphicUpdate,
        id,
        {
          label: before.label,
          theme: before.theme,
          graphicType: before.graphicType,
          imagePath: before.imagePath,
        },
        {
          label: row.label,
          theme: row.theme,
          graphicType: row.graphicType,
          imagePath: row.imagePath,
        },
      );
      return toDto(row);
    });

    if (
      normalizedImagePath !== undefined &&
      previousImagePath &&
      previousImagePath !== normalizedImagePath
    ) {
      await deleteBadgeGraphicFile(appKey, previousImagePath);
    }

    return updated;
  }

  async archive(actor: BadgeGraphicActor, appKey: string, id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.badgeGraphic.findFirst({ where: { id, appKey } });
      if (!before) throw new BadgeGraphicNotFoundError(id);
      await tx.badgeGraphic.update({
        where: { id },
        data: { status: "ARCHIVED" },
      });
      await this.clearDefaultSlugIfMatches(tx, appKey, before.slug);
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.BadgeGraphicArchive,
        id,
        { slug: before.slug, status: before.status },
        { slug: before.slug, status: "ARCHIVED" },
      );
    });
  }

  /** Permanently delete a badge graphic + its CP-stored asset (if any). */
  async remove(actor: BadgeGraphicActor, appKey: string, id: string): Promise<void> {
    const deleted = await this.db.$transaction(async (tx) => {
      const before = await tx.badgeGraphic.findFirst({ where: { id, appKey } });
      if (!before) throw new BadgeGraphicNotFoundError(id);
      await tx.badgeGraphic.delete({ where: { id } });
      await this.clearDefaultSlugIfMatches(tx, appKey, before.slug);
      await this.appendAudit(
        tx,
        actor,
        appKey,
        AuditActions.BadgeGraphicDelete,
        id,
        {
          slug: before.slug,
          label: before.label,
          imagePath: before.imagePath,
          status: before.status,
        },
        null,
      );
      return before;
    });
    await deleteBadgeGraphicFile(appKey, deleted.imagePath);
  }

  private async appendAudit(
    tx: TxClient,
    actor: BadgeGraphicActor,
    appKey: string,
    action: string,
    target: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue | null,
  ): Promise<void> {
    await this.audit.append(
      {
        actorUserId: actor.id,
        actorEmail: actor.email ?? null,
        appKey,
        merchantShop: null,
        action,
        target,
        before,
        after,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      tx,
    );
  }
}

let instance: BadgeGraphicService | null = null;
export function getBadgeGraphicService(): BadgeGraphicService {
  if (!instance) instance = new BadgeGraphicService();
  return instance;
}
