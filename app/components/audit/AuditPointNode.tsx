import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Globe,
  Terminal,
  Cpu,
  Monitor,
  Shield,
  Layers,
  ArrowRight,
} from "lucide-react";
import { StoreAvatar } from "~/components/StoreAvatar.js";
import { AuditActionIcon } from "./AuditActionIcon.js";
import {
  formatAuditNarrative,
  getActionCategory,
  formatRelativeTime,
  type AuditRecordLike,
} from "~/lib/auditTrailFormat.js";

export interface AuditPointNodeProps {
  readonly record: AuditRecordLike;
  readonly isLast?: boolean;
  readonly forceExpand?: boolean;
}

/** Formats timestamp to readable string. */
function formatExactTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Pretty prints JSON data or returns empty label. */
function formatJsonPretty(value: unknown): string {
  if (value === null || value === undefined) return "None";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AuditPointNode({
  record,
  isLast = false,
  forceExpand,
}: AuditPointNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const narrative = formatAuditNarrative(record);
  const category = getActionCategory(record.action);
  const showPayload = forceExpand !== undefined ? forceExpand : isExpanded;

  const hasDiffOrPayload =
    record.before !== null && record.before !== undefined ||
    record.after !== null && record.after !== undefined ||
    record.ip ||
    record.userAgent ||
    record.target;

  const actorLabel = record.actorEmail || record.actorUserId || "Operator";
  const isSystem = record.actorType === "SYSTEM";

  const copyPayload = () => {
    const payload = {
      id: record.id,
      action: record.action,
      actor: actorLabel,
      actorType: record.actorType,
      source: record.source,
      appKey: record.appKey,
      merchantShop: record.merchantShop,
      target: record.target,
      before: record.before,
      after: record.after,
      ip: record.ip,
      userAgent: record.userAgent,
      createdAt: record.createdAt,
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex items-start gap-4 group pb-6">
      {/* Vertical Connecting Line */}
      {!isLast && (
        <div
          className="absolute left-4 top-9 bottom-0 w-0.5 bg-gray-200 dark:bg-zinc-800 group-hover:bg-amber-500/40 transition-colors"
          aria-hidden="true"
        />
      )}

      {/* Point Node / Action Icon */}
      <div className="relative z-10 pt-0.5 shrink-0">
        <AuditActionIcon action={record.action} size="md" />
      </div>

      {/* Main Trail Card */}
      <div className="flex-1 min-w-0 bg-white dark:bg-[#0E0E14] border border-gray-200 dark:border-[#22222E] rounded-xl p-4 shadow-sm hover:border-amber-500/30 transition-all">
        {/* Top Meta Line: Badges & Time */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Category Badge */}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${category.badgeBg} ${category.badgeText} ${category.badgeBorder}`}
            >
              {category.label}
            </span>

            {/* Action Tag */}
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 font-mono">
              {narrative.tag}
            </span>

            {/* Source Pill (UI / JOB / API) */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-50 dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-zinc-800"
              title={`Source: ${record.source || "UI"}`}
            >
              {record.source === "JOB" ? (
                <Cpu className="w-3 h-3 text-purple-400" />
              ) : record.source === "API" ? (
                <Terminal className="w-3 h-3 text-blue-400" />
              ) : (
                <Monitor className="w-3 h-3 text-emerald-400" />
              )}
              <span>{record.source || "UI"}</span>
            </span>

            {/* Actor Type Pill */}
            {isSystem ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                <Shield className="w-3 h-3" />
                <span>SYSTEM</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <span>STAFF</span>
              </span>
            )}

            {/* App Key */}
            {record.appKey && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400">
                <Layers className="w-3 h-3" />
                <span>{record.appKey}</span>
              </span>
            )}
          </div>

          {/* Timestamp */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400 shrink-0">
            <time
              dateTime={record.createdAt}
              title={formatExactTime(record.createdAt)}
              className="hover:underline cursor-help"
            >
              {formatRelativeTime(record.createdAt)}
            </time>
          </div>
        </div>

        {/* Narrative Headline */}
        <div className="mt-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
            {narrative.headline}
          </p>
          {narrative.details && (
            <p className="text-xs text-gray-600 dark:text-zinc-400 mt-0.5">
              {narrative.details}
            </p>
          )}
        </div>

        {/* Store & Target Information Pills */}
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-2.5 border-t border-gray-100 dark:border-zinc-800/60">
          {record.merchantShop ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-xs text-gray-800 dark:text-zinc-200 font-medium">
              <StoreAvatar shop={record.merchantShop} size="xs" />
              <span className="font-mono">{record.merchantShop}</span>
            </div>
          ) : (
            <span className="text-xs text-gray-400 dark:text-zinc-500 italic">
              Global control-plane scope
            </span>
          )}

          {record.target && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-zinc-800/70 text-[11px] font-mono text-gray-600 dark:text-zinc-400">
              <span className="text-gray-400 dark:text-zinc-500">target:</span>
              <span className="truncate max-w-[180px]" title={record.target}>
                {record.target}
              </span>
            </div>
          )}

          {/* Action technical identifier */}
          <code className="text-[11px] text-gray-400 dark:text-zinc-500 ml-auto font-mono">
            {record.action}
          </code>
        </div>

        {/* Expandable Details Button */}
        {hasDiffOrPayload && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors focus:outline-none"
            >
              {showPayload ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Hide payload & network details</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>View payload diff & details</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Expanded Payload & Diff Viewer */}
        {showPayload && (
          <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-zinc-800 space-y-3">
            {/* Network / Actor Details Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-gray-50 dark:bg-zinc-900/90 rounded-lg p-2.5 border border-gray-200 dark:border-zinc-800">
              <div>
                <span className="text-gray-500 dark:text-zinc-500 font-medium">Actor ID: </span>
                <span className="font-mono text-gray-800 dark:text-zinc-300">
                  {record.actorUserId}
                </span>
                {record.actorEmail && (
                  <span className="text-gray-500 dark:text-zinc-400 ml-1">
                    ({record.actorEmail})
                  </span>
                )}
              </div>
              <div>
                <span className="text-gray-500 dark:text-zinc-500 font-medium">Timestamp: </span>
                <span className="text-gray-800 dark:text-zinc-300">
                  {formatExactTime(record.createdAt)}
                </span>
              </div>
              {record.ip && (
                <div className="flex items-center gap-1">
                  <Globe className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-500 dark:text-zinc-500 font-medium">IP: </span>
                  <span className="font-mono text-gray-800 dark:text-zinc-300">
                    {record.ip}
                  </span>
                </div>
              )}
              {record.userAgent && (
                <div className="col-span-full truncate" title={record.userAgent}>
                  <span className="text-gray-500 dark:text-zinc-500 font-medium">
                    User Agent:{" "}
                  </span>
                  <span className="text-gray-700 dark:text-zinc-400 font-mono text-[11px]">
                    {record.userAgent}
                  </span>
                </div>
              )}
            </div>

            {/* Before / After Diff */}
            {record.before !== undefined && record.before !== null && record.after !== undefined && record.after !== null ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {/* Before State */}
                <div className="bg-rose-500/5 dark:bg-rose-500/10 border border-rose-300/30 dark:border-rose-500/20 rounded-lg p-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-rose-700 dark:text-rose-300 mb-1">
                    <span>Before State</span>
                  </div>
                  <pre className="text-[11px] font-mono text-gray-800 dark:text-zinc-300 overflow-x-auto max-h-48 p-1.5 rounded bg-white/60 dark:bg-black/30">
                    {formatJsonPretty(record.before)}
                  </pre>
                </div>

                {/* After State */}
                <div className="bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-300/30 dark:border-emerald-500/20 rounded-lg p-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
                    <span>After State</span>
                  </div>
                  <pre className="text-[11px] font-mono text-gray-800 dark:text-zinc-300 overflow-x-auto max-h-48 p-1.5 rounded bg-white/60 dark:bg-black/30">
                    {formatJsonPretty(record.after)}
                  </pre>
                </div>
              </div>
            ) : record.after !== undefined && record.after !== null ? (
              <div className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-2.5">
                <div className="text-xs font-semibold text-gray-700 dark:text-zinc-300 mb-1">
                  Event Payload (After)
                </div>
                <pre className="text-[11px] font-mono text-gray-800 dark:text-zinc-300 overflow-x-auto max-h-48 p-1.5 rounded bg-white/80 dark:bg-black/40">
                  {formatJsonPretty(record.after)}
                </pre>
              </div>
            ) : record.before !== undefined && record.before !== null ? (
              <div className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-2.5">
                <div className="text-xs font-semibold text-gray-700 dark:text-zinc-300 mb-1">
                  Previous State (Before)
                </div>
                <pre className="text-[11px] font-mono text-gray-800 dark:text-zinc-300 overflow-x-auto max-h-48 p-1.5 rounded bg-white/80 dark:bg-black/40">
                  {formatJsonPretty(record.before)}
                </pre>
              </div>
            ) : null}

            {/* Quick Copy Button */}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={copyPayload}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Copied event JSON</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
