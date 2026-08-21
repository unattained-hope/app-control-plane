import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Layers,
  Search,
  Shield,
  Store,
  Tag,
  User,
  Users,
  X,
} from "lucide-react";
import { StoreAvatar } from "~/components/StoreAvatar.js";
import {
  getActionCategory,
  formatRelativeTime,
  type AuditRecordLike,
  type AuditCategoryKey,
  AUDIT_CATEGORIES,
} from "~/lib/auditTrailFormat.js";

export type AuditGroupingMode = "handler" | "store" | "category" | "unified";

export interface HandlerGroup {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly actorType: string;
  readonly count: number;
  readonly latestAt: string;
  readonly stores: { readonly shop: string; readonly count: number }[];
}

export interface StoreGroup {
  readonly shop: string;
  readonly count: number;
  readonly latestAt: string;
  readonly handlers: { readonly id: string; readonly name: string; readonly count: number }[];
}

export interface CategoryGroup {
  readonly key: AuditCategoryKey;
  readonly label: string;
  readonly count: number;
  readonly latestAt: string;
  readonly uniqueHandlers: number;
  readonly uniqueStores: number;
}

export interface AuditGroupSidebarProps {
  readonly records: readonly AuditRecordLike[];
  readonly mode: AuditGroupingMode;
  readonly onModeChange: (mode: AuditGroupingMode) => void;
  readonly selectedHandlerId: string | null;
  readonly selectedStoreShop: string | null;
  readonly selectedCategoryKey: AuditCategoryKey | null;
  readonly onSelectHandler: (handlerId: string | null, subStoreShop?: string | null) => void;
  readonly onSelectStore: (shop: string | null, subHandlerId?: string | null) => void;
  readonly onSelectCategory: (categoryKey: AuditCategoryKey | null) => void;
  readonly onSelectUnified: () => void;
}

export function AuditGroupSidebar({
  records,
  mode,
  onModeChange,
  selectedHandlerId,
  selectedStoreShop,
  selectedCategoryKey,
  onSelectHandler,
  onSelectStore,
  onSelectCategory,
  onSelectUnified,
}: AuditGroupSidebarProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleExpanded = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Group by Handler (Team Member / Job)
  const handlerGroups = useMemo<HandlerGroup[]>(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        email: string | null;
        actorType: string;
        count: number;
        latestAt: string;
        storesMap: Map<string, number>;
      }
    >();

    for (const r of records) {
      const id = r.actorUserId;
      const name = r.actorEmail || r.actorUserId;
      const existing = map.get(id);

      if (!existing) {
        const storesMap = new Map<string, number>();
        if (r.merchantShop) storesMap.set(r.merchantShop, 1);
        map.set(id, {
          id,
          name,
          email: r.actorEmail || null,
          actorType: r.actorType || "INTERNAL",
          count: 1,
          latestAt: r.createdAt,
          storesMap,
        });
      } else {
        existing.count += 1;
        if (r.merchantShop) {
          existing.storesMap.set(
            r.merchantShop,
            (existing.storesMap.get(r.merchantShop) || 0) + 1,
          );
        }
        if (Date.parse(r.createdAt) > Date.parse(existing.latestAt)) {
          existing.latestAt = r.createdAt;
        }
      }
    }

    return Array.from(map.values())
      .map((g) => ({
        id: g.id,
        name: g.name,
        email: g.email,
        actorType: g.actorType,
        count: g.count,
        latestAt: g.latestAt,
        stores: Array.from(g.storesMap.entries())
          .map(([shop, count]) => ({ shop, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count);
  }, [records]);

  // Group by Store (Merchant)
  const storeGroups = useMemo<StoreGroup[]>(() => {
    const map = new Map<
      string,
      {
        shop: string;
        count: number;
        latestAt: string;
        handlersMap: Map<string, { id: string; name: string; count: number }>;
      }
    >();

    for (const r of records) {
      const shop = r.merchantShop || "(Global Operations)";
      const existing = map.get(shop);
      const handlerId = r.actorUserId;
      const handlerName = r.actorEmail || r.actorUserId;

      if (!existing) {
        const handlersMap = new Map<
          string,
          { id: string; name: string; count: number }
        >();
        handlersMap.set(handlerId, { id: handlerId, name: handlerName, count: 1 });
        map.set(shop, {
          shop,
          count: 1,
          latestAt: r.createdAt,
          handlersMap,
        });
      } else {
        existing.count += 1;
        const h = existing.handlersMap.get(handlerId);
        if (!h) {
          existing.handlersMap.set(handlerId, {
            id: handlerId,
            name: handlerName,
            count: 1,
          });
        } else {
          h.count += 1;
        }
        if (Date.parse(r.createdAt) > Date.parse(existing.latestAt)) {
          existing.latestAt = r.createdAt;
        }
      }
    }

    return Array.from(map.values())
      .map((g) => ({
        shop: g.shop,
        count: g.count,
        latestAt: g.latestAt,
        handlers: Array.from(g.handlersMap.values()).sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count);
  }, [records]);

  // Group by Action Category
  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    const map = new Map<
      AuditCategoryKey,
      {
        key: AuditCategoryKey;
        label: string;
        count: number;
        latestAt: string;
        handlersSet: Set<string>;
        storesSet: Set<string>;
      }
    >();

    for (const r of records) {
      const meta = getActionCategory(r.action);
      const existing = map.get(meta.key);

      if (!existing) {
        const handlersSet = new Set<string>([r.actorUserId]);
        const storesSet = new Set<string>();
        if (r.merchantShop) storesSet.add(r.merchantShop);
        map.set(meta.key, {
          key: meta.key,
          label: meta.label,
          count: 1,
          latestAt: r.createdAt,
          handlersSet,
          storesSet,
        });
      } else {
        existing.count += 1;
        existing.handlersSet.add(r.actorUserId);
        if (r.merchantShop) existing.storesSet.add(r.merchantShop);
        if (Date.parse(r.createdAt) > Date.parse(existing.latestAt)) {
          existing.latestAt = r.createdAt;
        }
      }
    }

    return Array.from(map.values())
      .map((g) => ({
        key: g.key,
        label: g.label,
        count: g.count,
        latestAt: g.latestAt,
        uniqueHandlers: g.handlersSet.size,
        uniqueStores: g.storesSet.size,
      }))
      .sort((a, b) => b.count - a.count);
  }, [records]);

  // Filtered lists based on sidebar search
  const filteredHandlers = useMemo(() => {
    if (!searchTerm.trim()) return handlerGroups;
    const term = searchTerm.toLowerCase().trim();
    return handlerGroups.filter(
      (h) =>
        h.name.toLowerCase().includes(term) ||
        h.id.toLowerCase().includes(term) ||
        h.stores.some((s) => s.shop.toLowerCase().includes(term)),
    );
  }, [handlerGroups, searchTerm]);

  const filteredStores = useMemo(() => {
    if (!searchTerm.trim()) return storeGroups;
    const term = searchTerm.toLowerCase().trim();
    return storeGroups.filter(
      (s) =>
        s.shop.toLowerCase().includes(term) ||
        s.handlers.some((h) => h.name.toLowerCase().includes(term)),
    );
  }, [storeGroups, searchTerm]);

  const filteredCategories = useMemo(() => {
    if (!searchTerm.trim()) return categoryGroups;
    const term = searchTerm.toLowerCase().trim();
    return categoryGroups.filter((c) => c.label.toLowerCase().includes(term));
  }, [categoryGroups, searchTerm]);

  return (
    <div className="flex flex-col h-full bg-gray-50/50 dark:bg-[#0E0E14] border-r border-gray-200 dark:border-[#22222E]">
      {/* Mode Switcher Tabs */}
      <div className="p-3 border-b border-gray-200 dark:border-[#22222E]">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-gray-200/60 dark:bg-zinc-900 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => onModeChange("handler")}
            className={`py-1.5 px-2 rounded-md transition-colors text-center ${
              mode === "handler"
                ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm font-semibold"
                : "text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            Handlers ({handlerGroups.length})
          </button>
          <button
            type="button"
            onClick={() => onModeChange("store")}
            className={`py-1.5 px-2 rounded-md transition-colors text-center ${
              mode === "store"
                ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm font-semibold"
                : "text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            Stores ({storeGroups.length})
          </button>
          <button
            type="button"
            onClick={() => onModeChange("category")}
            className={`py-1.5 px-2 rounded-md transition-colors text-center ${
              mode === "category"
                ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm font-semibold"
                : "text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            Categories
          </button>
          <button
            type="button"
            onClick={() => {
              onModeChange("unified");
              onSelectUnified();
            }}
            className={`py-1.5 px-2 rounded-md transition-colors text-center ${
              mode === "unified"
                ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm font-semibold"
                : "text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            All Activity
          </button>
        </div>

        {/* Sidebar Search */}
        {mode !== "unified" && (
          <div className="mt-2.5 relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder={`Filter ${mode === "handler" ? "members & jobs" : mode === "store" ? "stores" : "categories"}…`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-7 py-1 text-xs bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-md focus:outline-none focus:border-amber-500 text-gray-900 dark:text-zinc-100 placeholder:text-gray-400"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Group List Stream */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* UNIFIED MODE */}
        {mode === "unified" && (
          <div className="p-3 text-xs text-gray-600 dark:text-zinc-400 space-y-2">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-800 dark:text-amber-300">
              <p className="font-semibold text-xs">Unified Chronological Stream</p>
              <p className="text-[11px] mt-1 opacity-90">
                Viewing all {records.length} audit trail events across all handlers, stores, and system services in real-time.
              </p>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-zinc-500">
              Switch to <strong>Handlers</strong> or <strong>Stores</strong> tabs to drill down into specific actor or merchant timelines.
            </p>
          </div>
        )}

        {/* HANDLERS MODE */}
        {mode === "handler" && (
          <>
            {filteredHandlers.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500 dark:text-zinc-400">
                No handlers match "{searchTerm}"
              </div>
            ) : (
              filteredHandlers.map((h) => {
                const isSelected = selectedHandlerId === h.id;
                const isExpanded = expandedItems[h.id] ?? false;

                return (
                  <div key={h.id} className="space-y-0.5">
                    <div
                      onClick={() => onSelectHandler(h.id, null)}
                      className={`group flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all border ${
                        isSelected
                          ? "bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/40 text-gray-900 dark:text-white font-medium"
                          : "bg-white dark:bg-zinc-900/60 border-transparent hover:border-gray-200 dark:hover:border-zinc-800 hover:bg-gray-100/70 dark:hover:bg-zinc-800/60 text-gray-700 dark:text-zinc-300"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Avatar / Icon */}
                        {h.actorType === "SYSTEM" ? (
                          <div className="w-7 h-7 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                            <Cpu className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5" />
                          </div>
                        )}

                        {/* Handler Name & Subtext */}
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-xs text-gray-900 dark:text-zinc-100">
                            {h.name}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
                            <span>
                              {h.stores.length} {h.stores.length === 1 ? "store" : "stores"}
                            </span>
                            <span>•</span>
                            <span>{formatRelativeTime(h.latestAt)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right Count Badge & Expand Chevron */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300">
                          {h.count}
                        </span>
                        {h.stores.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => toggleExpanded(h.id, e)}
                            className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200"
                            title="Expand stores"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Sub-items: Stores touched by this handler */}
                    {isExpanded && h.stores.length > 0 && (
                      <div className="pl-6 pr-1 space-y-1 py-1">
                        {h.stores.map((s) => {
                          const isStoreSelected =
                            selectedHandlerId === h.id && selectedStoreShop === s.shop;
                          return (
                            <div
                              key={s.shop}
                              onClick={() => onSelectHandler(h.id, s.shop)}
                              className={`flex items-center justify-between p-1.5 rounded-md text-[11px] cursor-pointer transition-colors ${
                                isStoreSelected
                                  ? "bg-amber-500/20 text-amber-900 dark:text-amber-200 font-semibold"
                                  : "hover:bg-gray-200/60 dark:hover:bg-zinc-800/80 text-gray-600 dark:text-zinc-400"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <StoreAvatar shop={s.shop} size="xs" />
                                <span className="truncate font-mono">{s.shop}</span>
                              </div>
                              <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-medium">
                                {s.count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* STORES MODE */}
        {mode === "store" && (
          <>
            {filteredStores.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500 dark:text-zinc-400">
                No stores match "{searchTerm}"
              </div>
            ) : (
              filteredStores.map((s) => {
                const isSelected = selectedStoreShop === s.shop;
                const isExpanded = expandedItems[s.shop] ?? false;

                return (
                  <div key={s.shop} className="space-y-0.5">
                    <div
                      onClick={() => onSelectStore(s.shop, null)}
                      className={`group flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all border ${
                        isSelected
                          ? "bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/40 text-gray-900 dark:text-white font-medium"
                          : "bg-white dark:bg-zinc-900/60 border-transparent hover:border-gray-200 dark:hover:border-zinc-800 hover:bg-gray-100/70 dark:hover:bg-zinc-800/60 text-gray-700 dark:text-zinc-300"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Store Avatar */}
                        {s.shop.includes(".") ? (
                          <StoreAvatar shop={s.shop} size="sm" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                            <Store className="w-3.5 h-3.5" />
                          </div>
                        )}

                        {/* Store Name & Subtext */}
                        <div className="min-w-0">
                          <p className="truncate font-mono font-semibold text-xs text-gray-900 dark:text-zinc-100">
                            {s.shop}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
                            <span>
                              {s.handlers.length} {s.handlers.length === 1 ? "handler" : "handlers"}
                            </span>
                            <span>•</span>
                            <span>{formatRelativeTime(s.latestAt)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right Count Badge & Expand */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300">
                          {s.count}
                        </span>
                        {s.handlers.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => toggleExpanded(s.shop, e)}
                            className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200"
                            title="Expand handlers"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Sub-items: Handlers who operated on this store */}
                    {isExpanded && s.handlers.length > 0 && (
                      <div className="pl-6 pr-1 space-y-1 py-1">
                        {s.handlers.map((h) => {
                          const isHandlerSelected =
                            selectedStoreShop === s.shop && selectedHandlerId === h.id;
                          return (
                            <div
                              key={h.id}
                              onClick={() => onSelectStore(s.shop, h.id)}
                              className={`flex items-center justify-between p-1.5 rounded-md text-[11px] cursor-pointer transition-colors ${
                                isHandlerSelected
                                  ? "bg-amber-500/20 text-amber-900 dark:text-amber-200 font-semibold"
                                  : "hover:bg-gray-200/60 dark:hover:bg-zinc-800/80 text-gray-600 dark:text-zinc-400"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <User className="w-3 h-3 text-gray-400" />
                                <span className="truncate">{h.name}</span>
                              </div>
                              <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-medium">
                                {h.count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* CATEGORIES MODE */}
        {mode === "category" && (
          <>
            {filteredCategories.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500 dark:text-zinc-400">
                No categories match "{searchTerm}"
              </div>
            ) : (
              filteredCategories.map((c) => {
                const isSelected = selectedCategoryKey === c.key;
                const meta = AUDIT_CATEGORIES[c.key];

                return (
                  <div
                    key={c.key}
                    onClick={() => onSelectCategory(c.key)}
                    className={`group flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all border ${
                      isSelected
                        ? "bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/40 text-gray-900 dark:text-white font-medium"
                        : "bg-white dark:bg-zinc-900/60 border-transparent hover:border-gray-200 dark:hover:border-zinc-800 hover:bg-gray-100/70 dark:hover:bg-zinc-800/60 text-gray-700 dark:text-zinc-300"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-full ${meta.badgeBg} ${meta.badgeText} flex items-center justify-center shrink-0 border ${meta.badgeBorder}`}
                      >
                        <Tag className="w-3.5 h-3.5" />
                      </div>

                      <div className="min-w-0">
                        <p className="truncate font-semibold text-xs text-gray-900 dark:text-zinc-100">
                          {c.label}
                        </p>
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
                          <span>{c.uniqueHandlers} members</span>
                          <span>•</span>
                          <span>{c.uniqueStores} stores</span>
                        </div>
                      </div>
                    </div>

                    <span className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 shrink-0">
                      {c.count}
                    </span>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Footer Total Summary */}
      <div className="p-3 border-t border-gray-200 dark:border-[#22222E] bg-gray-50 dark:bg-zinc-950 text-xs text-gray-500 dark:text-zinc-400 flex items-center justify-between">
        <span>Total loaded events:</span>
        <span className="font-semibold text-gray-900 dark:text-white font-mono">
          {records.length}
        </span>
      </div>
    </div>
  );
}
