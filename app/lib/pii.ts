/**
 * PII masking (cp-pii-governance). Protected customer data is masked by default in
 * every merchant read path; the raw value is only ever returned through the audited
 * `revealPii` mutation. Pure helpers — no I/O — so masking is trivially testable and
 * applied at a single server-side choke point.
 */

/**
 * Mask an email so the raw local part never crosses the wire: keep the first
 * character and the domain, replace the rest with a fixed mask. `null` stays `null`.
 *   "founder@aurora.com" -> "f•••@aurora.com"
 *   "a@b.com"            -> "•••@b.com"
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "•••"; // no/empty local part or no domain — fully mask
  const first = email[0];
  const domain = email.slice(at + 1);
  const lead = at > 1 ? `${first}•••` : "•••";
  return `${lead}@${domain}`;
}
