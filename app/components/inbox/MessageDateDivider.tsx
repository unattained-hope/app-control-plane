import { formatDateDivider } from "./format.js";

export function MessageDateDivider({ label }: { readonly label: string }) {
  return (
    <li className="apoaap-inbox-date-divider" aria-label={`Messages from ${label}`}>
      <span>{label}</span>
    </li>
  );
}

export function messageDateDividerLabel(iso: string): string {
  return formatDateDivider(iso);
}
