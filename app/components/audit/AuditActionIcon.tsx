import type { FC } from "react";
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  BellRing,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  FileCode,
  FileText,
  Flag,
  Flame,
  HeartPulse,
  Key,
  Megaphone,
  MessageSquare,
  Palette,
  Pin,
  RefreshCw,
  ScrollText,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Star,
  Store,
  Tag,
  Trash2,
  UserCheck,
  UserPlus,
  Webhook,
} from "lucide-react";
import { AuditActions } from "~/lib/auditActions.js";

export interface AuditActionIconProps {
  readonly action: string;
  readonly className?: string;
  readonly size?: "sm" | "md" | "lg";
}

/**
 * Returns a dedicated, visually distinctive Lucide icon component with
 * color and background styling for any audit log action.
 */
export function getActionIconComponent(action: string): FC<{ className?: string }> {
  switch (action) {
    // Merchant notes & tags
    case AuditActions.MerchantNoteAdd:
      return FileText;
    case AuditActions.MerchantNoteEdit:
      return FileText;
    case AuditActions.MerchantNoteDelete:
      return Trash2;
    case AuditActions.MerchantTagAdd:
    case AuditActions.MerchantTagRemove:
    case AuditActions.ConversationTagAdd:
    case AuditActions.ConversationTagRemove:
      return Tag;
    case AuditActions.MerchantPiiView:
      return Eye;

    // Roles & Access
    case AuditActions.UserRoleChange:
      return UserCheck;
    case AuditActions.BreakGlassRequested:
    case AuditActions.BreakGlassApproved:
    case AuditActions.BreakGlassActivated:
      return Key;
    case AuditActions.BreakGlassDenied:
    case AuditActions.BreakGlassRevoked:
    case AuditActions.BreakGlassExpired:
      return ShieldAlert;
    case AuditActions.ImpersonationStart:
    case AuditActions.ImpersonationEnd:
      return Shield;

    // Support Inbox
    case AuditActions.ConversationPrioritySet:
      return Flag;
    case AuditActions.ConversationAssigned:
      return UserPlus;
    case AuditActions.ConversationSlaBreaching:
    case AuditActions.ConversationSlaBreached:
      return AlertTriangle;
    case AuditActions.ConversationCsatRecorded:
      return Star;
    case "conversation.status.update":
      return CheckCircle2;
    case "conversation.pin.update":
    case "conversation.pinned":
      return Pin;

    // Canned replies
    case AuditActions.CannedReplyCreate:
    case AuditActions.CannedReplyUpdate:
    case AuditActions.CannedReplyDelete:
      return FileCode;

    // Compliance
    case AuditActions.ComplianceRequestReceived:
    case AuditActions.ComplianceDispatched:
    case AuditActions.ComplianceCompleted:
    case AuditActions.ComplianceFailed:
      return ShieldCheck;

    // Billing
    case AuditActions.BillingSubscriptionUpdated:
    case AuditActions.BillingCapApproaching:
    case AuditActions.BillingPlanChangeRequested:
    case AuditActions.BillingPlanChangeDispatched:
    case AuditActions.BillingPlanChangeCompleted:
    case AuditActions.BillingPlanChangeFailed:
      return CreditCard;

    // Webhooks & SLO
    case AuditActions.WebhookDeadLettered:
      return AlertTriangle;
    case AuditActions.WebhookReplayed:
      return RefreshCw;
    case AuditActions.SloAlertFired:
      return Flame;

    // Merchant Health & Lifecycle
    case AuditActions.MerchantHealthEvaluated:
      return HeartPulse;
    case AuditActions.MerchantUninstalled:
      return Trash2;
    case AuditActions.MerchantReinstalled:
      return Store;

    // Feature Flags
    case AuditActions.FeatureFlagCreate:
    case AuditActions.FeatureFlagUpdate:
    case AuditActions.FeatureFlagDelete:
    case AuditActions.FeatureFlagOverrideSet:
    case AuditActions.FeatureFlagOverrideClear:
      return Flag;

    // Announcements & NPS
    case AuditActions.AnnouncementPublish:
    case AuditActions.AnnouncementExpire:
      return Megaphone;
    case AuditActions.NpsRecorded:
      return Star;

    // Badge Graphics
    case AuditActions.BadgeGraphicCreate:
    case AuditActions.BadgeGraphicUpdate:
    case AuditActions.BadgeGraphicArchive:
    case AuditActions.BadgeGraphicDelete:
    case AuditActions.BadgeGraphicSetDefault:
      return Palette;

    // Usage & Alerts
    case AuditActions.UsageAlertRuleCreate:
    case AuditActions.UsageAlertRuleUpdate:
    case AuditActions.UsageAlertRuleEnable:
    case AuditActions.UsageAlertRuleDisable:
    case AuditActions.UsageAlertRuleDelete:
      return BarChart3;
    case AuditActions.UsageAlertFired:
    case AuditActions.UsageAlertRecovered:
      return BellRing;

    default:
      if (action.startsWith("conversation.")) return MessageSquare;
      if (action.startsWith("merchant.")) return Store;
      if (action.startsWith("user.") || action.startsWith("auth.")) return UserCheck;
      if (action.startsWith("billing.")) return CreditCard;
      if (action.startsWith("compliance.")) return ShieldCheck;
      if (action.startsWith("webhook.")) return Webhook;
      if (action.startsWith("feature.")) return Flag;
      if (action.startsWith("usage.")) return BarChart3;
      if (action.startsWith("badge.")) return Award;
      return ScrollText;
  }
}

/**
 * Returns color classes for the icon container based on action type.
 */
export function getActionIconStyle(action: string): {
  readonly container: string;
  readonly icon: string;
} {
  // Danger / Breaches / Deletions
  if (
    action.includes("breach") ||
    action.includes("dead_letter") ||
    action.includes("failed") ||
    action.includes("delete") ||
    action.includes("revoked") ||
    action.includes("uninstalled") ||
    action === AuditActions.SloAlertFired
  ) {
    return {
      container:
        "bg-rose-500/10 dark:bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400 shadow-rose-500/10",
      icon: "text-rose-600 dark:text-rose-400",
    };
  }

  // Security / Roles / Breakglass
  if (
    action.startsWith("breakglass.") ||
    action.startsWith("impersonation.") ||
    action.startsWith("user.") ||
    action.startsWith("auth.")
  ) {
    return {
      container:
        "bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400 shadow-amber-500/10",
      icon: "text-amber-600 dark:text-amber-400",
    };
  }

  // Support & Inbox
  if (action.startsWith("conversation.") || action.startsWith("inbox.")) {
    return {
      container:
        "bg-sky-500/10 dark:bg-sky-500/15 border-sky-500/30 text-sky-600 dark:text-sky-400 shadow-sky-500/10",
      icon: "text-sky-600 dark:text-sky-400",
    };
  }

  // Merchant Ops & Notes
  if (action.startsWith("merchant.")) {
    return {
      container:
        "bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-emerald-500/10",
      icon: "text-emerald-600 dark:text-emerald-400",
    };
  }

  // Billing
  if (action.startsWith("billing.")) {
    return {
      container:
        "bg-violet-500/10 dark:bg-violet-500/15 border-violet-500/30 text-violet-600 dark:text-violet-400 shadow-violet-500/10",
      icon: "text-violet-600 dark:text-violet-400",
    };
  }

  // Compliance
  if (action.startsWith("compliance.")) {
    return {
      container:
        "bg-teal-500/10 dark:bg-teal-500/15 border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-teal-500/10",
      icon: "text-teal-600 dark:text-teal-400",
    };
  }

  // Feature Flags
  if (action.startsWith("feature.")) {
    return {
      container:
        "bg-indigo-500/10 dark:bg-indigo-500/15 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 shadow-indigo-500/10",
      icon: "text-indigo-600 dark:text-indigo-400",
    };
  }

  // Announcements
  if (action.startsWith("announcement.") || action.startsWith("nps.")) {
    return {
      container:
        "bg-pink-500/10 dark:bg-pink-500/15 border-pink-500/30 text-pink-600 dark:text-pink-400 shadow-pink-500/10",
      icon: "text-pink-600 dark:text-pink-400",
    };
  }

  // Badge Graphics
  if (action.startsWith("badge.")) {
    return {
      container:
        "bg-cyan-500/10 dark:bg-cyan-500/15 border-cyan-500/30 text-cyan-600 dark:text-cyan-400 shadow-cyan-500/10",
      icon: "text-cyan-600 dark:text-cyan-400",
    };
  }

  // Usage & Alerts
  if (action.startsWith("usage.")) {
    return {
      container:
        "bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400 shadow-blue-500/10",
      icon: "text-blue-600 dark:text-blue-400",
    };
  }

  // Default fallback
  return {
    container:
      "bg-zinc-500/10 dark:bg-zinc-500/15 border-zinc-500/30 text-zinc-600 dark:text-zinc-400 shadow-zinc-500/10",
    icon: "text-zinc-600 dark:text-zinc-400",
  };
}

export function AuditActionIcon({
  action,
  className = "",
  size = "md",
}: AuditActionIconProps) {
  const Icon = getActionIconComponent(action);
  const style = getActionIconStyle(action);

  const sizeStyles = {
    sm: "w-6 h-6 p-1 text-xs",
    md: "w-8 h-8 p-1.5 text-sm",
    lg: "w-10 h-10 p-2 text-base",
  }[size];

  const iconSizes = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  }[size];

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full border shadow-sm shrink-0 transition-transform ${style.container} ${sizeStyles} ${className}`}
      title={action}
      aria-hidden="true"
    >
      <Icon className={`${iconSizes} ${style.icon}`} />
    </div>
  );
}
