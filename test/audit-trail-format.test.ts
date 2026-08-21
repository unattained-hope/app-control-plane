import { describe, it, expect } from "vitest";
import {
  formatAuditNarrative,
  getActionCategory,
  getDateBucketLabel,
  formatRelativeTime,
  AUDIT_CATEGORIES,
} from "../app/lib/auditTrailFormat.js";
import { AuditActions } from "../app/lib/auditActions.js";

describe("auditTrailFormat", () => {
  it("categorizes actions accurately", () => {
    expect(getActionCategory(AuditActions.MerchantNoteAdd).key).toBe("merchant");
    expect(getActionCategory(AuditActions.ConversationAssigned).key).toBe("support");
    expect(getActionCategory(AuditActions.UserRoleChange).key).toBe("access");
    expect(getActionCategory(AuditActions.BillingPlanChangeRequested).key).toBe("billing");
    expect(getActionCategory(AuditActions.ComplianceRequestReceived).key).toBe("compliance");
    expect(getActionCategory(AuditActions.FeatureFlagCreate).key).toBe("flags");
    expect(getActionCategory(AuditActions.WebhookReplayed).key).toBe("reliability");
    expect(getActionCategory("custom.unknown.action").key).toBe("other");
  });

  it("generates clear human-readable narrative for notes and tags", () => {
    const noteEvent = formatAuditNarrative({
      action: AuditActions.MerchantNoteAdd,
      actorUserId: "usr_123",
      actorEmail: "sarah@apoaap.dev",
      merchantShop: "my-cool-store.myshopify.com",
      createdAt: new Date().toISOString(),
    });
    expect(noteEvent.headline).toBe("sarah@apoaap.dev added an internal note");
    expect(noteEvent.details).toContain("my-cool-store.myshopify.com");
    expect(noteEvent.tag).toBe("Note Added");

    const tagEvent = formatAuditNarrative({
      action: AuditActions.MerchantTagAdd,
      actorUserId: "usr_123",
      actorEmail: "admin@apoaap.dev",
      merchantShop: "boutique.myshopify.com",
      after: { tag: "VIP" },
      createdAt: new Date().toISOString(),
    });
    expect(tagEvent.headline).toBe('admin@apoaap.dev added tag "VIP"');
    expect(tagEvent.details).toContain("boutique.myshopify.com");
  });

  it("generates clear narrative for roles, support, and jobs", () => {
    const roleEvent = formatAuditNarrative({
      action: AuditActions.UserRoleChange,
      actorUserId: "usr_admin",
      actorEmail: "admin@apoaap.dev",
      target: "alex@apoaap.dev",
      before: { role: "SUPPORT" },
      after: { role: "ADMIN", targetUser: "alex@apoaap.dev" },
      createdAt: new Date().toISOString(),
    });
    expect(roleEvent.headline).toBe("admin@apoaap.dev changed role for alex@apoaap.dev");
    expect(roleEvent.details).toBe("Changed from SUPPORT → ADMIN");

    const rollupEvent = formatAuditNarrative({
      action: AuditActions.MerchantHealthEvaluated,
      actorUserId: "system:growth-rollup",
      actorEmail: null,
      merchantShop: "craft-theme-store.myshopify.com",
      after: { score: 92 },
      createdAt: new Date().toISOString(),
    });
    expect(rollupEvent.headline).toBe("Merchant health evaluated (Score: 92)");
    expect(rollupEvent.details).toContain("craft-theme-store.myshopify.com");
  });

  it("formats relative timestamps and date bucket labels", () => {
    const nowIso = new Date().toISOString();
    expect(formatRelativeTime(nowIso)).toBe("Just now");
    expect(getDateBucketLabel(nowIso)).toBe("Today");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(getDateBucketLabel(yesterday.toISOString())).toBe("Yesterday");
  });
});
