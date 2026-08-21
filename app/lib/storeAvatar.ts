export interface StoreAvatarColor {
  readonly bg: string;
  readonly text: string;
  readonly border?: string;
}

/**
 * 12-color vibrant accessible palette for store initials avatars, matching Shopify style.
 */
export const STORE_AVATAR_PALETTE: readonly StoreAvatarColor[] = [
  { bg: "#10b981", text: "#ffffff", border: "#059669" }, // Emerald / Green (like STS)
  { bg: "#8b5cf6", text: "#ffffff", border: "#7c3aed" }, // Violet / Purple (like CTS)
  { bg: "#0ea5e9", text: "#ffffff", border: "#0284c7" }, // Sky Blue (like HTS / TS)
  { bg: "#06b6d4", text: "#ffffff", border: "#0891b2" }, // Cyan / Teal
  { bg: "#6366f1", text: "#ffffff", border: "#4f46e5" }, // Indigo
  { bg: "#ec4899", text: "#ffffff", border: "#db2777" }, // Pink
  { bg: "#f59e0b", text: "#ffffff", border: "#d97706" }, // Amber
  { bg: "#f97316", text: "#ffffff", border: "#ea580c" }, // Orange
  { bg: "#14b8a6", text: "#ffffff", border: "#0d9488" }, // Teal
  { bg: "#a855f7", text: "#ffffff", border: "#9333ea" }, // Purple
  { bg: "#3b82f6", text: "#ffffff", border: "#2563eb" }, // Blue
  { bg: "#e11d48", text: "#ffffff", border: "#be123c" }, // Rose
];

/**
 * Stable, deterministic color selection from domain or name.
 */
export function getStoreColor(shopOrName: string): StoreAvatarColor {
  let hash = 0;
  const str = (shopOrName || "").trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return STORE_AVATAR_PALETTE[hash % STORE_AVATAR_PALETTE.length] ?? STORE_AVATAR_PALETTE[0]!;
}

/**
 * Extract 1-3 initials from a store name or domain, mirroring Shopify's store avatar initials.
 * Examples:
 *   "Sense Theme Store" -> "STS"
 *   "Craft Theme Store" -> "CTS"
 *   "Horizon Theme Store" -> "HTS"
 *   "Test Store" -> "TS"
 *   "craft-theme-store.myshopify.com" -> "CTS"
 *   "sense-theme-store-wk9lnd86.myshopify.com" -> "STS"
 */
export function getStoreInitials(name?: string | null, shop?: string | null): string {
  const hasName = Boolean(
    name &&
      name.trim().length > 0 &&
      name.trim().toLowerCase() !== shop?.trim().toLowerCase(),
  );

  let raw = hasName ? name!.trim() : (shop ?? "").trim();
  if (!raw) return "ST";

  // If raw contains .myshopify.com or a web domain suffix, strip it
  if (raw.toLowerCase().includes(".myshopify.com") || !hasName) {
    raw = raw.replace(/\.myshopify\.com$/i, "").replace(/\.[a-z]{2,}(?::\d+)?$/i, "");
  }

  // Handle phrases with delimiters like "Test Store 1 -Saleswitch Dev Testing-"
  // Take the primary prefix before the dash delimiter if meaningful
  if (hasName && (raw.includes(" - ") || raw.includes(" -"))) {
    const parts = raw.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0 && parts[0]!.length > 0) {
      raw = parts[0]!;
    }
  }

  // Remove parentheses, brackets, quotes, punctuation
  raw = raw.replace(/[\(\)\[\]\{\}"'“”‘’]/g, " ").trim();

  // Split into words by whitespace, dashes, underscores, dots
  let tokens = raw
    .split(/[\s\-_.]+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, "").trim())
    .filter(Boolean);

  if (tokens.length === 0) return "ST";

  // Filter out auto-generated random suffix tokens (e.g. wk9lnd86, k27ioqsc, 1100000000000000000000000000002187)
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    const isLongNumeric = /^\d{5,}$/.test(last);
    const isRandomHash = /^(?=[a-z]*[0-9])(?=[0-9]*[a-z])[a-z0-9]{7,}$/i.test(last);
    if (isLongNumeric || isRandomHash) {
      tokens = tokens.slice(0, -1);
    }
  }

  // If we have words with letters, filter out pure numbers (like "1" in "Test Store 1")
  if (tokens.some((t) => /[a-zA-Z]/.test(t))) {
    tokens = tokens.filter((t) => /[a-zA-Z]/.test(t));
  }

  if (tokens.length === 0) return "ST";

  if (tokens.length === 1) {
    const single = tokens[0]!;
    return single.length >= 2 ? single.slice(0, 2).toUpperCase() : single.toUpperCase();
  }

  if (tokens.length === 2) {
    return (tokens[0]![0]! + tokens[1]![0]!).toUpperCase();
  }

  // 3 or more words -> take first char of first 3 words (e.g. "Sense Theme Store" -> "STS")
  return (tokens[0]![0]! + tokens[1]![0]! + tokens[2]![0]!).toUpperCase();
}
