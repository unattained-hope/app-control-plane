import { useMemo, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  Layers,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { AuditPointNode } from "./AuditPointNode.js";
import { getDateBucketLabel, type AuditRecordLike } from "~/lib/auditTrailFormat.js";

export interface AuditTrailTimelineProps {
  readonly records: readonly AuditRecordLike[];
  readonly isLoading?: boolean;
  readonly title?: string;
  readonly subtitle?: string;
  readonly onClearFilter?: () => void;
  readonly activeFilterDescription?: string;
}

export function AuditTrailTimeline({
  records,
  isLoading = false,
  title = "Activity Trail",
  subtitle,
  onClearFilter,
  activeFilterDescription,
}: AuditTrailTimelineProps) {
  const [trailSearch, setTrailSearch] = useState("");
  const [expandAll, setExpandAll] = useState(false);

  // Filter trail items by instant search text (matches actor, shop, action, target, payload)
  const filteredRecords = useMemo(() => {
    if (!trailSearch.trim()) return records;
    const term = trailSearch.toLowerCase().trim();
    return records.filter((r) => {
      const matchActor =
        r.actorUserId.toLowerCase().includes(term) ||
        (r.actorEmail && r.actorEmail.toLowerCase().includes(term));
      const matchShop = r.merchantShop && r.merchantShop.toLowerCase().includes(term);
      const matchAction = r.action.toLowerCase().includes(term);
      const matchTarget = r.target && r.target.toLowerCase().includes(term);
      const matchApp = r.appKey && r.appKey.toLowerCase().includes(term);
      const matchPayload =
        (r.before && JSON.stringify(r.before).toLowerCase().includes(term)) ||
        (r.after && JSON.stringify(r.after).toLowerCase().includes(term));

      return (
        matchActor || matchShop || matchAction || matchTarget || matchApp || matchPayload
      );
    });
  }, [records, trailSearch]);

  // Group records by Date Bucket ("Today", "Yesterday", "Monday, Aug 18, 2026")
  const dateBuckets = useMemo(() => {
    const map = new Map<string, AuditRecordLike[]>();
    for (const record of filteredRecords) {
      const bucketKey = getDateBucketLabel(record.createdAt);
      const list = map.get(bucketKey) ?? [];
      list.push(record);
      map.set(bucketKey, list);
    }
    return Array.from(map.entries());
  }, [filteredRecords]);

  const handleExportJson = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(filteredRecords, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `audit-trail-export-${new Date().toISOString().slice(0, 10)}.json`,
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-gray-500 dark:text-zinc-400">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-medium">Loading activity trail…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Timeline Header & Local Controls */}
      <div className="p-4 border-b border-gray-200 dark:border-[#22222E] bg-white/50 dark:bg-[#0E0E14]/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <span>{title}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {filteredRecords.length} {filteredRecords.length === 1 ? "event" : "events"}
              </span>
            </h2>
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>
            )}
            {activeFilterDescription && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Filtering by: {activeFilterDescription}
                </span>
                {onClearFilter && (
                  <button
                    type="button"
                    onClick={onClearFilter}
                    className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-200 underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Quick Actions (Search in trail, Expand all, Export) */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search within this trail */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search events in trail…"
                value={trailSearch}
                onChange={(e) => setTrailSearch(e.target.value)}
                className="pl-8 pr-7 py-1 text-xs bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-md focus:outline-none focus:border-amber-500 text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 w-44 sm:w-56"
              />
              {trailSearch && (
                <button
                  type="button"
                  onClick={() => setTrailSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Toggle Expand / Collapse All Payloads */}
            <button
              type="button"
              onClick={() => setExpandAll(!expandAll)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300 transition-colors"
              title={expandAll ? "Collapse all payloads" : "Expand all payloads"}
            >
              {expandAll ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Collapse All</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Expand All</span>
                </>
              )}
            </button>

            {/* Export JSON */}
            <button
              type="button"
              onClick={handleExportJson}
              disabled={filteredRecords.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300 transition-colors disabled:opacity-50"
              title="Download filtered activity as JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Point by Point Timeline Stream */}
      <div className="p-4 sm:p-6 overflow-y-auto flex-1">
        {filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center bg-gray-50/50 dark:bg-zinc-900/30 rounded-xl border border-dashed border-gray-200 dark:border-zinc-800">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 mb-3">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              No activity points found
            </h3>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1 max-w-sm">
              {trailSearch
                ? `No events match "${trailSearch}". Try refining or clearing your search.`
                : "There are no audit trail points recorded for this scope."}
            </p>
            {trailSearch && (
              <button
                type="button"
                onClick={() => setTrailSearch("")}
                className="mt-3 text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline"
              >
                Clear search filter
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {dateBuckets.map(([bucketLabel, bucketRecords], bucketIdx) => (
              <div key={bucketLabel} className="space-y-3">
                {/* Date Divider */}
                <div className="sticky top-0 z-10 py-2 my-1 bg-white/95 dark:bg-[#0E0E14]/95 backdrop-blur-sm flex items-center gap-3">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700 shadow-sm shrink-0">
                    <Calendar className="w-3.5 h-3.5 text-amber-500" />
                    <span>{bucketLabel}</span>
                    <span className="text-gray-400 dark:text-zinc-500 text-[11px] font-normal">
                      ({bucketRecords.length})
                    </span>
                  </div>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-zinc-800" />
                </div>

                {/* Trail Points */}
                <div className="pl-1 pt-2">
                  {bucketRecords.map((record, index) => (
                    <AuditPointNode
                      key={record.id || `${record.action}-${record.createdAt}-${index}`}
                      record={record}
                      isLast={
                        bucketIdx === dateBuckets.length - 1 &&
                        index === bucketRecords.length - 1
                      }
                      forceExpand={expandAll ? true : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
