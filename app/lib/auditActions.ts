/**
 * The typed audit-event taxonomy (cp-audit-taxonomy).
 *
 * Audit `action` values are drawn from this single source rather than ad-hoc
 * free-text strings, so the event set is inspectable, greppable, and stable across
 * call sites. The `action` column stays a `String` (forward-compatible with rows
 * written before this taxonomy existed and with future actions), but every NEW
 * call site references a constant here. Adding an action = adding one entry.
 */
export const AuditActions = {
  // Merchant actions (cp-merchant-actions).
  MerchantNoteAdd: "merchant.note.add",
  MerchantNoteEdit: "merchant.note.edit",
  MerchantTagAdd: "merchant.tag.add",
  MerchantTagRemove: "merchant.tag.remove",
  MerchantPiiView: "merchant.pii.view",

  // Roles / registry (cp-auth-rbac).
  UserRoleChange: "user.role.change",

  // GDPR / DSR (cp-compliance-dsr).
  ComplianceRequestReceived: "compliance.request.received",
  ComplianceDispatched: "compliance.dispatched",
  ComplianceFailed: "compliance.failed",
  ComplianceCompleted: "compliance.completed",

  // Billing (cp-billing-monitoring).
  BillingSubscriptionUpdated: "billing.subscription.updated",
  BillingCapApproaching: "billing.cap.approaching",

  // Support inbox (cp-inbox-sla, cp-conversation-routing, cp-conversation-csat).
  ConversationPrioritySet: "conversation.priority.set",
  ConversationSlaBreaching: "conversation.sla.breaching",
  ConversationSlaBreached: "conversation.sla.breached",
  ConversationAssigned: "conversation.assigned",
  ConversationTagAdd: "conversation.tag.add",
  ConversationTagRemove: "conversation.tag.remove",
  ConversationCsatRecorded: "conversation.csat.recorded",

  // Canned replies / routing rules (cp-canned-replies, cp-conversation-routing).
  CannedReplyCreate: "canned.reply.create",
  CannedReplyUpdate: "canned.reply.update",
  CannedReplyDelete: "canned.reply.delete",
  RoutingRuleCreate: "routing.rule.create",
  RoutingRuleUpdate: "routing.rule.update",

  // Webhook reliability (cp-webhook-reliability). Job-sourced where noted.
  WebhookDeadLettered: "webhook.dead_lettered", // SYSTEM/JOB on retry exhaustion
  WebhookReplayed: "webhook.replayed", // ADMIN-triggered manual replay

  // SLO alerting (cp-slo-alerting). Emitted from the ops tick (SYSTEM/JOB).
  SloAlertFired: "slo.alert.fired",

  // Break-glass / justified access (cp-break-glass-rbac).
  BreakGlassRequested: "breakglass.requested",
  BreakGlassApproved: "breakglass.approved",
  BreakGlassDenied: "breakglass.denied",
  BreakGlassActivated: "breakglass.activated",
  BreakGlassRevoked: "breakglass.revoked",
  BreakGlassExpired: "breakglass.expired", // SYSTEM/JOB sweep
  ImpersonationStart: "impersonation.start",
  ImpersonationEnd: "impersonation.end",

  // Merchant health & churn (cp-merchant-health, cp-uninstall-churn). Job-sourced.
  MerchantHealthEvaluated: "merchant.health.evaluated", // SYSTEM/JOB rollup
  MerchantUninstalled: "merchant.uninstalled", // SYSTEM/JOB on app/uninstalled
  MerchantReinstalled: "merchant.reinstalled", // SYSTEM/JOB inferred reinstall

  // Feature flags (cp-feature-flags). ADMIN-managed registry + per-shop overrides.
  FeatureFlagCreate: "feature.flag.create",
  FeatureFlagUpdate: "feature.flag.update",
  FeatureFlagDelete: "feature.flag.delete",
  FeatureFlagOverrideSet: "feature.flag.override.set",
  FeatureFlagOverrideClear: "feature.flag.override.clear",

  // Announcements + NPS (cp-announcements-nps).
  AnnouncementPublish: "announcement.publish",
  AnnouncementExpire: "announcement.expire", // SYSTEM/JOB sweep
  NpsRecorded: "nps.recorded", // merchant-sourced via the widget

  // Self-serve billing (cp-self-serve-billing). Plan change dispatched to the app API.
  BillingPlanChangeRequested: "billing.plan.change.requested",
  BillingPlanChangeDispatched: "billing.plan.change.dispatched",
  BillingPlanChangeCompleted: "billing.plan.change.completed",
  BillingPlanChangeFailed: "billing.plan.change.failed",

  // App settings — badge graphic gallery (cp-app-settings).
  BadgeGraphicCreate: "badge.graphic.create",
  BadgeGraphicUpdate: "badge.graphic.update",
  BadgeGraphicArchive: "badge.graphic.archive",
  BadgeGraphicDelete: "badge.graphic.delete",
  BadgeGraphicSetDefault: "badge.graphic.setDefault",

  // Usage alert rules (cp usage-alerts-digest, usage-analytics P5). ADMIN-managed
  // registry of threshold rules over the pre-rolled metrics; enable/disable/edit are
  // audited like other admin writes. The breach + recovery notices are JOB-sourced.
  UsageAlertRuleCreate: "usage.alert.rule.create",
  UsageAlertRuleUpdate: "usage.alert.rule.update",
  UsageAlertRuleEnable: "usage.alert.rule.enable",
  UsageAlertRuleDisable: "usage.alert.rule.disable",
  UsageAlertRuleDelete: "usage.alert.rule.delete",
  UsageAlertFired: "usage.alert.fired", // SYSTEM/JOB on OK→BREACHED
  UsageAlertRecovered: "usage.alert.recovered", // SYSTEM/JOB on BREACHED→OK
} as const;

/** The union of all known audit action identifiers. */
export type KnownAuditAction = (typeof AuditActions)[keyof typeof AuditActions];
