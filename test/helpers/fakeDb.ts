import { Prisma } from "@prisma/client";

/**
 * Minimal in-memory Prisma double for DB-free service tests. Supports only what the
 * Tier-0 services exercise: create / findUnique(OrThrow) / findMany / update across
 * webhookEvent, auditLog, complianceRequest, billingAlert — plus a `$transaction`
 * that gives REAL atomicity (snapshot on entry, restore on throw) so same-transaction
 * audit rollback can be asserted.
 */

export function p2002(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

export function p2025(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "test",
  });
}

interface Row {
  [k: string]: unknown;
  id: string;
}

export class FakeDb {
  webhookEvent: ReturnType<FakeDb["webhookEventModel"]>;
  auditLog: ReturnType<FakeDb["auditLogModel"]>;
  complianceRequest: ReturnType<FakeDb["complianceRequestModel"]>;
  billingAlert: ReturnType<FakeDb["billingAlertModel"]>;
  conversation: ReturnType<FakeDb["conversationModel"]>;
  message: ReturnType<FakeDb["messageModel"]>;
  cannedReply: ReturnType<FakeDb["cannedReplyModel"]>;
  assignmentRule: ReturnType<FakeDb["assignmentRuleModel"]>;
  conversationTag: ReturnType<FakeDb["conversationTagModel"]>;
  breakGlassGrant: ReturnType<FakeDb["breakGlassGrantModel"]>;
  kpiSnapshot: ReturnType<FakeDb["kpiSnapshotModel"]>;
  // Tier 3 — growth & retention (cp-* capabilities). Generic CRUD via genericModel.
  merchantNote: ReturnType<FakeDb["genericModel"]>;
  merchantHealthSnapshot: ReturnType<FakeDb["genericModel"]>;
  merchantLifecycleEvent: ReturnType<FakeDb["genericModel"]>;
  featureFlag: ReturnType<FakeDb["genericModel"]>;
  featureFlagOverride: ReturnType<FakeDb["genericModel"]>;
  announcement: ReturnType<FakeDb["genericModel"]>;
  npsResponse: ReturnType<FakeDb["genericModel"]>;
  planChangeRequest: ReturnType<FakeDb["genericModel"]>;
  app: ReturnType<FakeDb["genericModel"]>;
  badgeGraphic: ReturnType<FakeDb["badgeGraphicModel"]>;
  usageEvent: ReturnType<FakeDb["usageEventModel"]>;
  usageSyncCursor: ReturnType<FakeDb["usageSyncCursorModel"]>;
  usageMetricDaily: ReturnType<FakeDb["usageMetricDailyModel"]>;
  usageCohortSnapshot: ReturnType<FakeDb["genericModel"]>;
  usageAlertRule: ReturnType<FakeDb["genericModel"]>;
  usageAlertState: ReturnType<FakeDb["usageAlertStateModel"]>;
  usageSavedView: ReturnType<FakeDb["genericModel"]>;

  store: {
    webhookEvent: Row[];
    auditLog: Row[];
    complianceRequest: Row[];
    billingAlert: Row[];
    conversation: Row[];
    message: Row[];
    cannedReply: Row[];
    assignmentRule: Row[];
    conversationTag: Row[];
    breakGlassGrant: Row[];
    kpiSnapshot: Row[];
    merchantNote: Row[];
    merchantHealthSnapshot: Row[];
    merchantLifecycleEvent: Row[];
    featureFlag: Row[];
    featureFlagOverride: Row[];
    announcement: Row[];
    npsResponse: Row[];
  planChangeRequest: Row[];
  app: Row[];
  badgeGraphic: Row[];
  usageEvent: Row[];
  usageSyncCursor: Row[];
  usageMetricDaily: Row[];
  usageCohortSnapshot: Row[];
  usageAlertRule: Row[];
  usageAlertState: Row[];
  usageSavedView: Row[];
  } = {
    webhookEvent: [],
    auditLog: [],
    complianceRequest: [],
    billingAlert: [],
    conversation: [],
    message: [],
    cannedReply: [],
    assignmentRule: [],
    conversationTag: [],
    breakGlassGrant: [],
    kpiSnapshot: [],
    merchantNote: [],
    merchantHealthSnapshot: [],
    merchantLifecycleEvent: [],
    featureFlag: [],
    featureFlagOverride: [],
    announcement: [],
    npsResponse: [],
    planChangeRequest: [],
    app: [],
    badgeGraphic: [],
    usageEvent: [],
    usageSyncCursor: [],
    usageMetricDaily: [],
    usageCohortSnapshot: [],
    usageAlertRule: [],
    usageAlertState: [],
    usageSavedView: [],
  };

  /** Set true to make every `auditLog.create` throw (force same-tx rollback). */
  failAudit = false;

  private seq = 0;
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  constructor() {
    this.webhookEvent = this.webhookEventModel();
    this.auditLog = this.auditLogModel();
    this.complianceRequest = this.complianceRequestModel();
    this.billingAlert = this.billingAlertModel();
    this.conversation = this.conversationModel();
    this.message = this.messageModel();
    this.cannedReply = this.cannedReplyModel();
    this.assignmentRule = this.assignmentRuleModel();
    this.conversationTag = this.conversationTagModel();
    this.breakGlassGrant = this.breakGlassGrantModel();
    this.kpiSnapshot = this.kpiSnapshotModel();
    this.merchantNote = this.genericModel("merchantNote", "mn");
    this.merchantHealthSnapshot = this.genericModel("merchantHealthSnapshot", "mhs");
    this.merchantLifecycleEvent = this.genericModel("merchantLifecycleEvent", "mle", () => ({
      occurredAt: new Date(),
      reason: null,
    }));
    this.featureFlag = this.genericModel("featureFlag", "ff", () => ({
      description: null,
      rolloutPercentage: null,
      updatedAt: new Date(),
    }));
    this.featureFlagOverride = this.genericModel("featureFlagOverride", "ffo", () => ({
      updatedAt: new Date(),
    }));
    this.announcement = this.genericModel("announcement", "ann", () => ({
      audienceValue: null,
      publishedAt: null,
      expiresAt: null,
      updatedAt: new Date(),
    }));
    this.npsResponse = this.genericModel("npsResponse", "nps", () => ({
      conversationId: null,
      comment: null,
    }));
    this.planChangeRequest = this.genericModel("planChangeRequest", "pcr", () => ({
      status: "REQUESTED",
      fromPlan: null,
      confirmationUrl: null,
      externalRef: null,
      conversationId: null,
      error: null,
      updatedAt: new Date(),
    }));
    this.app = this.genericModel("app", "app", () => ({
      defaultBadgeGraphicSlug: null,
      updatedAt: new Date(),
    }));
    this.badgeGraphic = this.badgeGraphicModel();
    this.usageEvent = this.usageEventModel();
    this.usageSyncCursor = this.usageSyncCursorModel();
    this.usageMetricDaily = this.usageMetricDailyModel();
    this.usageCohortSnapshot = this.genericModel("usageCohortSnapshot", "ucs", () => ({
      personaTags: [],
    }));
    this.usageAlertRule = this.genericModel("usageAlertRule", "uar", () => ({
      dimension: "",
      enabled: false,
      updatedAt: new Date(),
    }));
    this.usageAlertState = this.usageAlertStateModel();
    this.usageSavedView = this.genericModel("usageSavedView", "usv", () => ({
      updatedAt: new Date(),
    }));
  }

  /**
   * Per-rule alert-episode state with the alert service's exact needs: `findUnique` /
   * `upsert` on the unique `ruleId` (a non-`id` unique, like usageSyncCursor's appKey).
   */
  private usageAlertStateModel() {
    const rows = this.store.usageAlertState;
    return {
      findUnique: async ({ where }: { where: { ruleId: string } }) =>
        rows.find((r) => r.ruleId === where.ruleId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { ruleId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = rows.find((r) => r.ruleId === where.ruleId);
        if (existing) {
          applyUpdate(existing, { ...update, updatedAt: new Date() });
          return existing;
        }
        const row: Row = { id: this.nextId("uas"), updatedAt: new Date(), ...create };
        rows.push(row);
        return row;
      },
    };
  }

  /**
   * Dimensioned daily-metric model with the rollup's exact need: `upsert` on the
   * compound unique `(appKey, date, metric, dimension)` — overwriting `value` in place
   * so a re-run is idempotent (Prisma's `where.appKey_date_metric_dimension` shape).
   * Dates compare by epoch so distinct Date instances for the same UTC day collapse.
   */
  private usageMetricDailyModel() {
    const rows = this.store.usageMetricDaily;
    const keyOf = (appKey: string, date: Date, metric: string, dimension: string) =>
      `${appKey}::${date.getTime()}::${metric}::${dimension}`;
    return {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: {
          appKey_date_metric_dimension: {
            appKey: string;
            date: Date;
            metric: string;
            dimension: string;
          };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const k = where.appKey_date_metric_dimension;
        const existing = rows.find(
          (r) =>
            keyOf(r.appKey as string, r.date as Date, r.metric as string, r.dimension as string) ===
            keyOf(k.appKey, k.date, k.metric, k.dimension),
        );
        if (existing) {
          applyUpdate(existing, { ...update, updatedAt: new Date() });
          return existing;
        }
        const row: Row = {
          id: this.nextId("umd"),
          dimension: "",
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        rows.push(row);
        return row;
      },
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      }) => sortRows(rows.filter((r) => genericMatch(r, where)), orderBy),
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.filter((r) => genericMatch(r, where)).length,
    };
  }

  /**
   * Mirror-table model with the ingest service's exact needs: `createMany` that
   * honors `skipDuplicates` on the `(appKey, sourceEventId)` unique, plus reads
   * for tests. Mirrors Prisma's semantics closely enough for the drain/dedup tests.
   */
  private usageEventModel() {
    const rows = this.store.usageEvent;
    const key = (r: Row) => `${String(r.appKey)}::${String(r.sourceEventId)}`;
    return {
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: Record<string, unknown>[];
        skipDuplicates?: boolean;
      }) => {
        const seen = new Set(rows.map(key));
        let count = 0;
        for (const d of data) {
          const row: Row = { id: this.nextId("ue"), ingestedAt: new Date(), ...d };
          const k = key(row);
          if (skipDuplicates && seen.has(k)) continue;
          seen.add(k);
          rows.push(row);
          count += 1;
        }
        return { count };
      },
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
      }) => {
        let out = sortRows(rows.filter((r) => genericMatch(r, where)), orderBy);
        if (typeof take === "number") out = out.slice(0, take);
        return out;
      },
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.filter((r) => genericMatch(r, where)).length,
      aggregate: async ({ where }: { where?: Record<string, unknown> }) => {
        const matched = rows.filter((r) => genericMatch(r, where));
        let max: Date | null = null;
        for (const r of matched) {
          const o = r.occurredAt as Date | undefined;
          if (o && (max === null || o > max)) max = o;
        }
        return { _max: { occurredAt: max } };
      },
      deleteMany: async ({ where }: { where?: Record<string, unknown> }) => {
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (genericMatch(rows[i]!, where)) {
            rows.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
    };
  }

  /** Per-app cursor with `findUnique`/`upsert` on the unique `appKey`. */
  private usageSyncCursorModel() {
    const rows = this.store.usageSyncCursor;
    return {
      findUnique: async ({ where }: { where: { appKey: string } }) =>
        rows.find((r) => r.appKey === where.appKey) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { appKey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = rows.find((r) => r.appKey === where.appKey);
        if (existing) {
          applyUpdate(existing, { ...update, updatedAt: new Date() });
          return existing;
        }
        const row: Row = { id: this.nextId("usc"), updatedAt: new Date(), ...create };
        rows.push(row);
        return row;
      },
    };
  }

  private badgeGraphicModel() {
    const rows = this.store.badgeGraphic;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (
          rows.some(
            (r) => r.appKey === data.appKey && r.slug === data.slug,
          )
        ) {
          throw p2002("BadgeGraphic_appKey_slug_key");
        }
        const row: Row = {
          id: this.nextId("bg"),
          status: "ACTIVE",
          textBaked: true,
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      },
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      }) => sortRows(rows.filter((r) => genericMatch(r, where)), orderBy)[0] ?? null,
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
      }) => {
        let out = rows.filter((r) => genericMatch(r, where));
        if (orderBy) {
          const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
          for (const ob of [...orders].reverse()) {
            out = sortRows(out, ob);
          }
        }
        return out;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        applyUpdate(row, { ...data, updatedAt: new Date() });
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) throw p2025();
        return rows.splice(i, 1)[0]!;
      },
    };
  }

  /**
   * Generic in-memory model covering the CRUD the Tier-3 services exercise:
   * create / createMany / findUnique / findFirst / findMany / count / update / delete /
   * deleteMany — with the same `genericMatch` / `sortRows` / `applyUpdate` helpers the
   * hand-written models use. `defaults` supplies Prisma column defaults the service
   * relies on (e.g. `occurredAt`, `updatedAt`, nullable columns).
   */
  private genericModel(
    storeKey: keyof FakeDb["store"],
    prefix: string,
    defaults: () => Record<string, unknown> = () => ({}),
  ) {
    const rows = this.store[storeKey];
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: this.nextId(prefix), createdAt: new Date(), ...defaults(), ...data };
        rows.push(row);
        return row;
      },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) {
          rows.push({ id: this.nextId(prefix), createdAt: new Date(), ...defaults(), ...d });
        }
        return { count: data.length };
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      }) => sortRows(rows.filter((r) => genericMatch(r, where)), orderBy)[0] ?? null,
      findMany: async ({
        where,
        orderBy,
        skip,
        take,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
        skip?: number;
        take?: number;
      }) => {
        let out = sortRows(rows.filter((r) => genericMatch(r, where)), orderBy);
        if (typeof skip === "number") out = out.slice(skip);
        if (typeof take === "number") out = out.slice(0, take);
        return out;
      },
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.filter((r) => genericMatch(r, where)).length,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        applyUpdate(row, { ...data, updatedAt: new Date() });
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) throw p2025();
        return rows.splice(i, 1)[0]!;
      },
      deleteMany: async ({ where }: { where?: Record<string, unknown> }) => {
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (genericMatch(rows[i]!, where)) {
            rows.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
    };
  }

  /**
   * Atomic: restore the store IN PLACE if the callback throws (tx client === this).
   * Restoring in place keeps each array's identity stable, since the model closures
   * captured those array references.
   */
  async $transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.store);
    const savedSeq = this.seq;
    try {
      return await fn(this);
    } catch (err) {
      for (const key of Object.keys(this.store) as (keyof FakeDb["store"])[]) {
        this.store[key].length = 0;
        this.store[key].push(...snapshot[key]);
      }
      this.seq = savedSeq;
      throw err;
    }
  }

  private webhookEventModel() {
    const rows = this.store.webhookEvent;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (rows.some((r) => r.shopifyWebhookId === data.shopifyWebhookId)) {
          throw p2002("WebhookEvent_shopifyWebhookId_key");
        }
        const row: Row = {
          id: this.nextId("whe"),
          status: "RECEIVED",
          attempts: 0,
          contentHash: null,
          lastAttemptAt: null,
          error: null,
          processedAt: null,
          receivedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findFirst: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.find((r) => genericMatch(r, where)) ?? null,
      findMany: async ({
        where,
        orderBy,
        skip,
        take,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
        skip?: number;
        take?: number;
      }) => {
        let out = sortRows(rows.filter((r) => genericMatch(r, where)), orderBy);
        if (typeof skip === "number") out = out.slice(skip);
        if (typeof take === "number") out = out.slice(0, take);
        return out;
      },
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.filter((r) => genericMatch(r, where)).length,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        applyUpdate(row, data);
        return row;
      },
    };
  }

  private breakGlassGrantModel() {
    const rows = this.store.breakGlassGrant;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = {
          id: this.nextId("bgg"),
          status: "REQUESTED",
          targetShop: null,
          approverUserId: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      }) => sortRows(rows.filter((r) => genericMatch(r, where)), orderBy)[0] ?? null,
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
      }) => {
        const out = sortRows(rows.filter((r) => genericMatch(r, where)), orderBy);
        return typeof take === "number" ? out.slice(0, take) : out;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        applyUpdate(row, { ...data, updatedAt: new Date() });
        return row;
      },
    };
  }

  private kpiSnapshotModel() {
    const rows = this.store.kpiSnapshot;
    return {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) {
          rows.push({ id: this.nextId("kpi"), createdAt: new Date(), ...d });
        }
        return { count: data.length };
      },
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      }) => sortRows(rows.filter((r) => genericMatch(r, where)), orderBy),
    };
  }

  private auditLogModel() {
    const rows = this.store.auditLog;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (this.failAudit) throw new Error("forced audit failure");
        const row: Row = { id: this.nextId("aud"), createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
    };
  }

  private complianceRequestModel() {
    const rows = this.store.complianceRequest;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: this.nextId("cr"), ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        Object.assign(row, data);
        return row;
      },
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where?: {
          appKey?: string;
          status?: { in?: string[] };
          dueAt?: { lte?: Date };
        };
        orderBy?: { dueAt?: "asc" | "desc" };
        take?: number;
      }) => {
        let out = rows.filter((r) => {
          if (where?.appKey && r.appKey !== where.appKey) return false;
          if (where?.status?.in && !where.status.in.includes(r.status as string)) return false;
          if (where?.dueAt?.lte && (r.dueAt as Date) > where.dueAt.lte) return false;
          return true;
        });
        if (orderBy?.dueAt) {
          out = [...out].sort((a, b) => {
            const d = (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime();
            return orderBy.dueAt === "desc" ? -d : d;
          });
        }
        return typeof take === "number" ? out.slice(0, take) : out;
      },
    };
  }

  private billingAlertModel() {
    const rows = this.store.billingAlert;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: this.nextId("ba"), resolvedAt: null, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      }) => sortRows(rows.filter((r) => genericMatch(r, where)), orderBy)[0] ?? null,
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      }) => sortRows(rows.filter((r) => genericMatch(r, where)), orderBy),
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.filter((r) => genericMatch(r, where)).length,
    };
  }

  private conversationModel() {
    const rows = this.store.conversation;
    const matchOne = (row: Row, where?: Record<string, unknown>): boolean =>
      conversationMatches(row, where, this.store);
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = {
          id: this.nextId("cv"),
          status: "OPEN",
          assignedTo: null,
          subject: null,
          unreadCount: 0,
          priority: "NONE",
          slaState: "ON_TRACK",
          firstReplyAt: null,
          firstResponseDueAt: null,
          resolutionDueAt: null,
          csatScore: null,
          csatComment: null,
          lastMessageAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      }) => {
        const out = sortRows(rows.filter((r) => matchOne(r, where)), orderBy);
        return out[0] ?? null;
      },
      findMany: async ({
        where,
        orderBy,
        skip,
        take,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
        skip?: number;
        take?: number;
      }) => {
        let out = sortRows(rows.filter((r) => matchOne(r, where)), orderBy);
        if (typeof skip === "number") out = out.slice(skip);
        if (typeof take === "number") out = out.slice(0, take);
        return out;
      },
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.filter((r) => matchOne(r, where)).length,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      deleteMany: async ({ where }: { where?: Record<string, unknown> }) => {
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (matchOne(rows[i]!, where)) {
            rows.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
    };
  }

  private messageModel() {
    const rows = this.store.message;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = {
          id: this.nextId("msg"),
          internal: false,
          attachmentUrl: null,
          createdAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      },
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: { conversationId?: string; internal?: boolean };
        orderBy?: Record<string, "asc" | "desc">;
      }) => {
        let out = rows.filter((r) => {
          if (where?.conversationId && r.conversationId !== where.conversationId) return false;
          if (where?.internal !== undefined && r.internal !== where.internal) return false;
          return true;
        });
        out = sortRows(out, orderBy);
        return out;
      },
    };
  }

  private cannedReplyModel() {
    const rows = this.store.cannedReply;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (rows.some((r) => r.appKey === data.appKey && r.shortcut === data.shortcut)) {
          throw p2002("CannedReply_appKey_shortcut_key");
        }
        const now = new Date();
        const row: Row = { id: this.nextId("cr"), createdAt: now, updatedAt: now, ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: { appKey?: string };
        orderBy?: Record<string, "asc" | "desc">;
      }) => sortRows(rows.filter((r) => !where?.appKey || r.appKey === where.appKey), orderBy),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) throw p2025();
        return rows.splice(i, 1)[0]!;
      },
    };
  }

  private assignmentRuleModel() {
    const rows = this.store.assignmentRule;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = {
          id: this.nextId("ar"),
          active: true,
          assignTo: null,
          setPriority: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: { appKey?: string; active?: boolean };
        orderBy?: Record<string, "asc" | "desc">;
      }) =>
        sortRows(
          rows.filter((r) => {
            if (where?.appKey && r.appKey !== where.appKey) return false;
            if (where?.active !== undefined && r.active !== where.active) return false;
            return true;
          }),
          orderBy,
        ),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw p2025();
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    };
  }

  private conversationTagModel() {
    const rows = this.store.conversationTag;
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (rows.some((r) => r.conversationId === data.conversationId && r.label === data.label)) {
          throw p2002("ConversationTag_conversationId_label_key");
        }
        const row: Row = { id: this.nextId("ct"), createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: { conversationId?: string };
        orderBy?: Record<string, "asc" | "desc">;
      }) =>
        sortRows(
          rows.filter((r) => !where?.conversationId || r.conversationId === where.conversationId),
          orderBy,
        ),
      deleteMany: async ({ where }: { where: { conversationId?: string; label?: string } }) => {
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const r = rows[i]!;
          if (where.conversationId && r.conversationId !== where.conversationId) continue;
          if (where.label && r.label !== where.label) continue;
          rows.splice(i, 1);
          count += 1;
        }
        return { count };
      },
    };
  }
}

/** Generic field-condition matcher for the operators our services actually use. */
function fieldMatch(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    return value === cond;
  }
  const c = cond as Record<string, unknown>;
  if ("not" in c) return value !== c.not;
  if ("in" in c) return Array.isArray(c.in) && c.in.includes(value as never);
  if ("contains" in c) {
    return String(value ?? "")
      .toLowerCase()
      .includes(String(c.contains).toLowerCase());
  }
  // Range operators are CONJUNCTIVE (Prisma ANDs them): a `{ gte, lt }` window must
  // satisfy BOTH bounds, so evaluate every present bound instead of returning on the
  // first. `cmp` returns -1/0/1 for Date, number, and bigint alike (Dates via epoch ms;
  // bigint compared as bigint so large `sourceSeq` cursors keep full precision).
  const rangeKeys = ["lte", "gte", "lt", "gt"] as const;
  if (rangeKeys.some((k) => k in c)) {
    if ("lte" in c && cmp(value, c.lte) > 0) return false;
    if ("gte" in c && cmp(value, c.gte) < 0) return false;
    if ("lt" in c && cmp(value, c.lt) >= 0) return false;
    if ("gt" in c && cmp(value, c.gt) <= 0) return false;
    return true;
  }
  return false;
}

/** Order two orderable values (Date/number/bigint) as -1/0/1. Dates compare by epoch ms. */
function cmp(a: unknown, b: unknown): number {
  const an: number | bigint = a instanceof Date ? a.getTime() : (a as number | bigint);
  const bn: number | bigint = b instanceof Date ? b.getTime() : (b as number | bigint);
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

/** Generic `where` matcher (top-level AND of fields, with `OR` arrays). */
function genericMatch(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      const clauses = (cond as Record<string, unknown>[]) ?? [];
      if (!clauses.some((clause) => genericMatch(row, clause))) return false;
      continue;
    }
    if (!fieldMatch(row[key], cond)) return false;
  }
  return true;
}

/** Apply a Prisma-ish update payload, honoring `{ increment: n }` on a field. */
function applyUpdate(row: Row, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date) && "increment" in value) {
      const inc = (value as { increment: number }).increment;
      row[key] = ((row[key] as number) ?? 0) + inc;
    } else {
      row[key] = value;
    }
  }
}

/** Conversation `where` matcher, including the inbox-search OR with relations. */
function conversationMatches(
  row: Row,
  where: Record<string, unknown> | undefined,
  store: FakeDb["store"],
): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      const clauses = cond as Record<string, unknown>[];
      const anyMatch = clauses.some((clause) => {
        if ("tags" in clause) {
          const labelCond = (clause.tags as { some: { label: unknown } }).some.label;
          return store.conversationTag.some(
            (t) => t.conversationId === row.id && fieldMatch(t.label, labelCond),
          );
        }
        if ("messages" in clause) {
          const bodyCond = (clause.messages as { some: { body: unknown } }).some.body;
          return store.message.some(
            (m) => m.conversationId === row.id && fieldMatch(m.body, bodyCond),
          );
        }
        const [field, fcond] = Object.entries(clause)[0]!;
        return fieldMatch(row[field], fcond);
      });
      if (!anyMatch) return false;
      continue;
    }
    if (!fieldMatch(row[key], cond)) return false;
  }
  return true;
}

/** Sort rows by a single-key orderBy (nulls last), matching Prisma-ish ordering. */
function sortRows(
  rows: Row[],
  orderBy?: Record<string, "asc" | "desc">,
): Row[] {
  if (!orderBy) return [...rows];
  const [key, dir] = Object.entries(orderBy)[0] ?? [];
  if (!key) return [...rows];
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = av instanceof Date ? av.getTime() : av;
    const bn = bv instanceof Date ? bv.getTime() : bv;
    const cmp = an < bn ? -1 : an > bn ? 1 : 0;
    return dir === "desc" ? -cmp : cmp;
  });
}
