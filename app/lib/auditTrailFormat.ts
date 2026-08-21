import type { AuditActorType, AuditSource } from "@prisma/client";
import { AuditActions } from "./auditActions.js";

export type AuditCategoryKey =
  | "support"
  | "merchant"
  | "access"
  | "billing"
  | "compliance"
  | "flags"
  | "announcements"
  | "badges"
  | "usage"
  | "reliability"
  | "routing"
  | "other";

export interface ActionCategoryMeta {
  readonly key: AuditCategoryKey;
  readonly label: string;
  readonly description: string;
  readonly colorClass: string;
  readonly badgeBg: string;
  readonly badgeText: string;
  readonly badgeBorder: string;
}

export const AUDIT_CATEGORIES: Record<AuditCategoryKey, ActionCategoryMeta> = {
  support: {
    key: "support",
    label: "Support & Inbox",
    description: "Customer conversations, assignments, SLA warnings, CSAT",
    colorClass: "text-sky-400",
    badgeBg: "bg-sky-500/10 dark:bg-sky-500/15",
    badgeText: "text-sky-700 dark:text-sky-300",
    badgeBorder: "border-sky-300/40 dark:border-sky-500/30",
  },
  merchant: {
    key: "merchant",
    label: "Merchant Ops",
    description: "Internal notes, tags, PII reveals, merchant health & installs",
    colorClass: "text-emerald-400",
    badgeBg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    badgeBorder: "border-emerald-300/40 dark:border-emerald-500/30",
  },
  access: {
    key: "access",
    label: "Roles & Break-Glass",
    description: "User role changes, emergency access, impersonation sessions",
    colorClass: "text-amber-400",
    badgeBg: "bg-amber-500/10 dark:bg-amber-500/15",
    badgeText: "text-amber-700 dark:text-amber-300",
    badgeBorder: "border-amber-300/40 dark:border-amber-500/30",
  },
  billing: {
    key: "billing",
    label: "Billing & Plans",
    description: "Subscription updates, cap thresholds, plan change requests",
    colorClass: "text-violet-400",
    badgeBg: "bg-violet-500/10 dark:bg-violet-500/15",
    badgeText: "text-violet-700 dark:text-violet-300",
    badgeBorder: "border-violet-300/40 dark:border-violet-500/30",
  },
  compliance: {
    key: "compliance",
    label: "GDPR & Compliance",
    description: "DSR requests, data erasure, export dispatches",
    colorClass: "text-teal-400",
    badgeBg: "bg-teal-500/10 dark:bg-teal-500/15",
    badgeText: "text-teal-700 dark:text-teal-300",
    badgeBorder: "border-teal-300/40 dark:border-teal-500/30",
  },
  flags: {
    key: "flags",
    label: "Feature Flags",
    description: "Feature flag creation, updates, and per-shop overrides",
    colorClass: "text-indigo-400",
    badgeBg: "bg-indigo-500/10 dark:bg-indigo-500/15",
    badgeText: "text-indigo-700 dark:text-indigo-300",
    badgeBorder: "border-indigo-300/40 dark:border-indigo-500/30",
  },
  announcements: {
    key: "announcements",
    label: "Announcements & NPS",
    description: "Banner broadcasts, expiration sweeps, NPS ratings",
    colorClass: "text-pink-400",
    badgeBg: "bg-pink-500/10 dark:bg-pink-500/15",
    badgeText: "text-pink-700 dark:text-pink-300",
    badgeBorder: "border-pink-300/40 dark:border-pink-500/30",
  },
  badges: {
    key: "badges",
    label: "Badge Graphics",
    description: "Badge graphic gallery assets and default settings",
    colorClass: "text-cyan-400",
    badgeBg: "bg-cyan-500/10 dark:bg-cyan-500/15",
    badgeText: "text-cyan-700 dark:text-cyan-300",
    badgeBorder: "border-cyan-300/40 dark:border-cyan-500/30",
  },
  usage: {
    key: "usage",
    label: "Usage & Alerts",
    description: "Usage analytics, threshold rule updates, breach alerts",
    colorClass: "text-blue-400",
    badgeBg: "bg-blue-500/10 dark:bg-blue-500/15",
    badgeText: "text-blue-700 dark:text-blue-300",
    badgeBorder: "border-blue-300/40 dark:border-blue-500/30",
  },
  reliability: {
    key: "reliability",
    label: "Webhooks & SLOs",
    description: "Webhook dead-lettering, manual replays, SLO alerts",
    colorClass: "text-rose-400",
    badgeBg: "bg-rose-500/10 dark:bg-rose-500/15",
    badgeText: "text-rose-700 dark:text-rose-300",
    badgeBorder: "border-rose-300/40 dark:border-rose-500/30",
  },
  routing: {
    key: "routing",
    label: "Canned Replies",
    description: "Canned reply templates and macros",
    colorClass: "text-purple-400",
    badgeBg: "bg-purple-500/10 dark:bg-purple-500/15",
    badgeText: "text-purple-700 dark:text-purple-300",
    badgeBorder: "border-purple-300/40 dark:border-purple-500/30",
  },
  other: {
    key: "other",
    label: "Other System Events",
    description: "General control-plane actions and automated sweeps",
    colorClass: "text-zinc-400",
    badgeBg: "bg-zinc-500/10 dark:bg-zinc-500/15",
    badgeText: "text-zinc-700 dark:text-zinc-300",
    badgeBorder: "border-zinc-300/40 dark:border-zinc-500/30",
  },
};

/** Categorize any action string into one of the known audit categories. */
export function getActionCategory(action: string): ActionCategoryMeta {
  if (
    action.startsWith("conversation.") ||
    action.startsWith("inbox.") ||
    action.includes(".csat.")
  ) {
    return AUDIT_CATEGORIES.support;
  }
  if (
    action.startsWith("merchant.")
  ) {
    return AUDIT_CATEGORIES.merchant;
  }
  if (
    action.startsWith("user.") ||
    action.startsWith("breakglass.") ||
    action.startsWith("impersonation.") ||
    action.startsWith("auth.")
  ) {
    return AUDIT_CATEGORIES.access;
  }
  if (action.startsWith("billing.")) {
    return AUDIT_CATEGORIES.billing;
  }
  if (action.startsWith("compliance.")) {
    return AUDIT_CATEGORIES.compliance;
  }
  if (action.startsWith("feature.")) {
    return AUDIT_CATEGORIES.flags;
  }
  if (action.startsWith("announcement.") || action.startsWith("nps.")) {
    return AUDIT_CATEGORIES.announcements;
  }
  if (action.startsWith("badge.")) {
    return AUDIT_CATEGORIES.badges;
  }
  if (action.startsWith("usage.")) {
    return AUDIT_CATEGORIES.usage;
  }
  if (action.startsWith("webhook.") || action.startsWith("slo.")) {
    return AUDIT_CATEGORIES.reliability;
  }
  if (action.startsWith("canned.") || action.startsWith("routing.")) {
    return AUDIT_CATEGORIES.routing;
  }
  return AUDIT_CATEGORIES.other;
}

export interface AuditRecordLike {
  readonly id?: string;
  readonly action: string;
  readonly actorUserId: string;
  readonly actorEmail?: string | null;
  readonly actorType?: AuditActorType;
  readonly source?: AuditSource;
  readonly appKey?: string | null;
  readonly merchantShop?: string | null;
  readonly target?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly createdAt: string;
}

/**
 * Generate human-readable narrative text describing who did what, to what target,
 * and for which store.
 */
export function formatAuditNarrative(record: AuditRecordLike): {
  readonly headline: string;
  readonly details: string | null;
  readonly tag: string;
} {
  const { action, actorEmail, actorUserId, merchantShop, target, before, after } = record;
  const actor = actorEmail || actorUserId || "Operator";
  const shopPart = merchantShop ? `for ${merchantShop}` : "";

  // Helper to safely cast json objects
  const afterObj = (typeof after === "object" && after !== null ? after : {}) as Record<
    string,
    unknown
  >;
  const beforeObj = (typeof before === "object" && before !== null ? before : {}) as Record<
    string,
    unknown
  >;

  switch (action) {
    // Merchant notes & tags
    case AuditActions.MerchantNoteAdd:
      return {
        headline: `${actor} added an internal note`,
        details: shopPart ? `Added note ${shopPart}` : null,
        tag: "Note Added",
      };
    case AuditActions.MerchantNoteEdit:
      return {
        headline: `${actor} edited an internal note`,
        details: shopPart ? `Updated note ${shopPart}` : null,
        tag: "Note Edited",
      };
    case AuditActions.MerchantNoteDelete:
      return {
        headline: `${actor} deleted an internal note`,
        details: shopPart ? `Removed note ${shopPart}` : null,
        tag: "Note Deleted",
      };
    case AuditActions.MerchantTagAdd: {
      const tag = (afterObj.tag as string) || target || "tag";
      return {
        headline: `${actor} added tag "${tag}"`,
        details: shopPart ? `Applied to ${merchantShop}` : null,
        tag: "Tag Added",
      };
    }
    case AuditActions.MerchantTagRemove: {
      const tag = (beforeObj.tag as string) || target || "tag";
      return {
        headline: `${actor} removed tag "${tag}"`,
        details: shopPart ? `Removed from ${merchantShop}` : null,
        tag: "Tag Removed",
      };
    }
    case AuditActions.MerchantPiiView:
      return {
        headline: `${actor} revealed masked PII`,
        details: shopPart ? `Accessed customer PII ${shopPart}` : null,
        tag: "PII Revealed",
      };

    // User Roles
    case AuditActions.UserRoleChange: {
      const newRole = (afterObj.role as string) || "updated role";
      const oldRole = (beforeObj.role as string) || "";
      const targetUser = (afterObj.targetUser as string) || target || "team member";
      return {
        headline: `${actor} changed role for ${targetUser}`,
        details: oldRole ? `Changed from ${oldRole} → ${newRole}` : `New role: ${newRole}`,
        tag: "Role Changed",
      };
    }

    // Support Conversations
    case AuditActions.ConversationPrioritySet: {
      const priority = (afterObj.priority as string) || "updated";
      return {
        headline: `${actor} set conversation priority to ${priority.toUpperCase()}`,
        details: shopPart ? `Updated conversation ${shopPart}` : null,
        tag: "Priority Set",
      };
    }
    case AuditActions.ConversationAssigned: {
      const assignee =
        (afterObj.assignedTo as string) ||
        (afterObj.agentName as string) ||
        (afterObj.email as string) ||
        target ||
        "agent";
      return {
        headline: `${actor} assigned conversation to ${assignee}`,
        details: shopPart ? `Conversation ${shopPart}` : null,
        tag: "Assigned",
      };
    }
    case AuditActions.ConversationSlaBreaching:
      return {
        headline: `SLA approaching breach warning`,
        details: shopPart ? `Conversation ${shopPart} nearing response SLA deadline` : null,
        tag: "SLA Warning",
      };
    case AuditActions.ConversationSlaBreached:
      return {
        headline: `SLA breached for conversation`,
        details: shopPart ? `Exceeded target response SLA ${shopPart}` : null,
        tag: "SLA Breached",
      };
    case AuditActions.ConversationTagAdd: {
      const tag = (afterObj.tag as string) || target || "tag";
      return {
        headline: `${actor} tagged conversation with "${tag}"`,
        details: shopPart ? `Conversation ${shopPart}` : null,
        tag: "Tagged",
      };
    }
    case AuditActions.ConversationTagRemove: {
      const tag = (beforeObj.tag as string) || target || "tag";
      return {
        headline: `${actor} removed tag "${tag}" from conversation`,
        details: shopPart ? `Conversation ${shopPart}` : null,
        tag: "Tag Removed",
      };
    }
    case AuditActions.ConversationCsatRecorded: {
      const score = afterObj.score ?? afterObj.rating ?? 5;
      return {
        headline: `Customer recorded CSAT rating: ${score}/5 ⭐`,
        details: shopPart ? `Feedback submitted ${shopPart}` : null,
        tag: "CSAT Feedback",
      };
    }

    // Compliance
    case AuditActions.ComplianceRequestReceived:
      return {
        headline: `GDPR / DSR compliance request received`,
        details: shopPart ? `Data subject request ${shopPart}` : null,
        tag: "GDPR Request",
      };
    case AuditActions.ComplianceDispatched:
      return {
        headline: `${actor} dispatched compliance data erasure/export`,
        details: shopPart ? `Executed for ${merchantShop}` : null,
        tag: "Compliance Dispatched",
      };
    case AuditActions.ComplianceCompleted:
      return {
        headline: `Compliance request completed successfully`,
        details: shopPart ? `Fulfilled for ${merchantShop}` : null,
        tag: "Compliance Done",
      };
    case AuditActions.ComplianceFailed:
      return {
        headline: `Compliance request failed`,
        details: shopPart ? `Error processing request ${shopPart}` : null,
        tag: "Compliance Error",
      };

    // Billing
    case AuditActions.BillingSubscriptionUpdated:
      return {
        headline: `Billing subscription updated`,
        details: shopPart ? `Shopify subscription synchronized ${shopPart}` : null,
        tag: "Subscription Updated",
      };
    case AuditActions.BillingCapApproaching:
      return {
        headline: `Usage approached billing cap`,
        details: shopPart ? `Merchant nearing usage limits ${shopPart}` : null,
        tag: "Cap Approaching",
      };
    case AuditActions.BillingPlanChangeRequested:
      return {
        headline: `${actor} requested plan change`,
        details: shopPart ? `Requested tier update ${shopPart}` : null,
        tag: "Plan Requested",
      };
    case AuditActions.BillingPlanChangeCompleted:
      return {
        headline: `Billing plan change completed`,
        details: shopPart ? `Activated new plan tier ${shopPart}` : null,
        tag: "Plan Activated",
      };

    // Webhooks & SLOs
    case AuditActions.WebhookDeadLettered:
      return {
        headline: `Webhook delivery dead-lettered after retries`,
        details: shopPart ? `Event failed delivery ${shopPart}` : null,
        tag: "Dead Letter",
      };
    case AuditActions.WebhookReplayed:
      return {
        headline: `${actor} manually replayed webhook`,
        details: shopPart ? `Re-dispatched delivery ${shopPart}` : null,
        tag: "Webhook Replayed",
      };
    case AuditActions.SloAlertFired:
      return {
        headline: `SLO error budget burn alert fired`,
        details: "High error budget consumption detected",
        tag: "SLO Alert",
      };

    // Break-Glass
    case AuditActions.BreakGlassRequested:
      return {
        headline: `${actor} requested break-glass emergency access`,
        details: target ? `Target: ${target}` : null,
        tag: "Access Request",
      };
    case AuditActions.BreakGlassApproved:
      return {
        headline: `${actor} approved break-glass access`,
        details: target ? `Granted to ${target}` : null,
        tag: "Access Approved",
      };
    case AuditActions.BreakGlassActivated:
      return {
        headline: `${actor} activated break-glass elevation`,
        details: "Elevated privileges session active",
        tag: "Elevated Mode",
      };
    case AuditActions.BreakGlassRevoked:
      return {
        headline: `${actor} revoked break-glass access`,
        details: target ? `Revoked for ${target}` : null,
        tag: "Access Revoked",
      };
    case AuditActions.ImpersonationStart:
      return {
        headline: `${actor} started merchant impersonation`,
        details: shopPart ? `Impersonating admin ${shopPart}` : null,
        tag: "Impersonation",
      };
    case AuditActions.ImpersonationEnd:
      return {
        headline: `${actor} ended merchant impersonation session`,
        details: shopPart ? `Finished session ${shopPart}` : null,
        tag: "Session Ended",
      };

    // Merchant Health
    case AuditActions.MerchantHealthEvaluated: {
      const score = afterObj.score ?? afterObj.healthScore;
      const scoreText = score !== undefined ? ` (Score: ${score})` : "";
      return {
        headline: `Merchant health evaluated${scoreText}`,
        details: shopPart ? `Daily health rollup evaluated ${shopPart}` : null,
        tag: "Health Evaluated",
      };
    }
    case AuditActions.MerchantUninstalled:
      return {
        headline: `Merchant uninstalled app`,
        details: shopPart ? `Uninstallation recorded ${shopPart}` : null,
        tag: "Uninstalled",
      };
    case AuditActions.MerchantReinstalled:
      return {
        headline: `Merchant reinstalled app`,
        details: shopPart ? `Reinstallation detected ${shopPart}` : null,
        tag: "Reinstalled",
      };

    // Feature Flags
    case AuditActions.FeatureFlagCreate: {
      const flagKey = (afterObj.key as string) || target || "flag";
      return {
        headline: `${actor} created feature flag "${flagKey}"`,
        details: null,
        tag: "Flag Created",
      };
    }
    case AuditActions.FeatureFlagOverrideSet: {
      const flagKey = (afterObj.key as string) || target || "flag";
      return {
        headline: `${actor} set feature override for "${flagKey}"`,
        details: shopPart ? `Override set ${shopPart}` : null,
        tag: "Flag Override",
      };
    }
    case AuditActions.FeatureFlagOverrideClear: {
      const flagKey = (beforeObj.key as string) || target || "flag";
      return {
        headline: `${actor} cleared feature override for "${flagKey}"`,
        details: shopPart ? `Override removed ${shopPart}` : null,
        tag: "Override Cleared",
      };
    }

    // Announcements
    case AuditActions.AnnouncementPublish: {
      const title = (afterObj.title as string) || "announcement";
      return {
        headline: `${actor} published banner: "${title}"`,
        details: null,
        tag: "Published",
      };
    }

    // Badge Graphics
    case AuditActions.BadgeGraphicCreate:
      return {
        headline: `${actor} uploaded badge graphic asset`,
        details: target ? `Asset: ${target}` : null,
        tag: "Graphic Created",
      };
    case AuditActions.BadgeGraphicSetDefault:
      return {
        headline: `${actor} set default badge graphic`,
        details: target ? `Default: ${target}` : null,
        tag: "Default Set",
      };

    // Usage Alert Rules
    case AuditActions.UsageAlertRuleCreate:
      return {
        headline: `${actor} created usage alert rule`,
        details: target ? `Rule: ${target}` : null,
        tag: "Rule Created",
      };
    case AuditActions.UsageAlertFired:
      return {
        headline: `Usage threshold breach alert fired`,
        details: target ? `Alert for ${target}` : null,
        tag: "Alert Fired",
      };
    case AuditActions.UsageAlertRecovered:
      return {
        headline: `Usage metric recovered within threshold`,
        details: target ? `Recovered for ${target}` : null,
        tag: "Alert Recovered",
      };

    // Fallback for custom / ad-hoc actions (e.g. conversation.status.update, etc.)
    default: {
      // If it looks like dot-separated (e.g. conversation.status.update)
      if (action.includes(".")) {
        const parts = action.split(".");
        const pretty = parts
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(" ");
        const lastPart = parts[parts.length - 1];
        return {
          headline: `${actor} performed ${pretty}`,
          details: shopPart ? `${shopPart}` : (target ? `Target: ${target}` : null),
          tag: lastPart ? lastPart.toUpperCase() : "Event",
        };
      }
      return {
        headline: `${actor} performed ${action}`,
        details: shopPart ? `${shopPart}` : (target ? `Target: ${target}` : null),
        tag: "Activity",
      };
    }
  }
}

/** Formats a relative timestamp (e.g. "Just now", "4m ago", "2h ago", "3d ago"). */
export function formatRelativeTime(isoString: string): string {
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return isoString;
  const now = Date.now();
  const diffSec = Math.floor((now - ts) / 1000);

  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    return `${mins}m ago`;
  }
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    return `${hours}h ago`;
  }
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Group key for dividing activities by date bucket (e.g., "Today", "Yesterday", "Aug 19, 2026"). */
export function getDateBucketLabel(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Unknown Date";

  const today = new Date();
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  if (isToday) return "Today";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
