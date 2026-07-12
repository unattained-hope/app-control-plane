import type { ConversationStatus, Priority, SenderType } from "./types.js";

export const STATUS_FILTERS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "SNOOZED", label: "Snoozed" },
  { value: "CLOSED", label: "Closed" },
];

export const STATUS_LABEL: Readonly<Record<ConversationStatus, string>> = {
  OPEN: "Open",
  SNOOZED: "Snoozed",
  CLOSED: "Closed",
};

export const SENDER_LABEL: Readonly<Record<SenderType, string>> = {
  MERCHANT: "Merchant",
  AGENT: "Agent",
  SYSTEM: "System",
};

export const PRIORITIES: readonly Priority[] = ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"];

export const PRIORITY_TONE: Readonly<Record<Priority, "rose" | "orange" | "blue" | "gray">> = {
  URGENT: "rose",
  HIGH: "orange",
  NORMAL: "blue",
  LOW: "gray",
  NONE: "gray",
};

export const SLA_TONE: Readonly<Record<string, "emerald" | "amber" | "rose" | "gray">> = {
  ON_TRACK: "gray",
  BREACHING: "amber",
  BREACHED: "rose",
  MET: "emerald",
};

export const SLA_LABEL: Readonly<Record<string, string>> = {
  ON_TRACK: "On track",
  BREACHING: "Breaching",
  BREACHED: "Breached",
  MET: "Met",
};

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

export function formatShopLabel(shop: string): string {
  const suffix = ".myshopify.com";
  return shop.endsWith(suffix) ? shop.slice(0, -suffix.length) : shop;
}

export function formatRelativeTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffMin = Math.round((Date.now() - ts) / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatPriorityLabel(priority: Priority): string {
  return priority === "NONE" ? "No priority" : priority;
}

export function formatSenderId(senderType: SenderType, senderId: string, shop: string): string {
  if (senderType === "SYSTEM") return "system";
  if (senderType === "MERCHANT") {
    return senderId === shop ? formatShopLabel(shop) : formatShopLabel(senderId);
  }
  return senderId;
}

export function countdownLabel(dueIso: string | null): string | null {
  if (!dueIso) return null;
  const due = Date.parse(dueIso);
  if (Number.isNaN(due)) return null;
  const diffMin = Math.round((due - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return diffMin >= 0 ? `due in ${span}` : `overdue ${span}`;
}

/** Group label for message date dividers ("Today", "Yesterday", or a locale date). */
export function formatDateDivider(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

export function dateKey(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
