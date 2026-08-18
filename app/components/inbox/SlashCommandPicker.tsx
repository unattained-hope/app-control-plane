import React, { useEffect, useState } from "react";
import { trpc } from "~/lib/trpc.js";

export interface SlashCommandPickerProps {
  readonly shop: string;
  readonly query: string;
  readonly isOpen: boolean;
  readonly onSelect: (body: string) => void;
  readonly onClose: () => void;
}

export function SlashCommandPicker({
  shop,
  query,
  isOpen,
  onSelect,
  onClose,
}: SlashCommandPickerProps) {
  const listQuery = trpc.canned.list.useQuery();
  const utils = trpc.useUtils();
  const replies = listQuery.data ?? [];
  const [selectedIndex, setSelectedIndex] = useState(0);

  const cleanQuery = query.toLowerCase().replace(/^\//, "");

  const filtered = replies.filter((r) => {
    if (!cleanQuery) return true;
    const shortcutMatch = r.shortcut.toLowerCase().includes(cleanQuery);
    const titleMatch = r.title.toLowerCase().includes(cleanQuery);
    return shortcutMatch || titleMatch;
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered.length > 0 && filtered[selectedIndex]) {
          e.preventDefault();
          e.stopPropagation();
          const target = filtered[selectedIndex];
          void handlePick(target.id);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isOpen, filtered, selectedIndex, onClose]);

  async function handlePick(id: string) {
    try {
      const rendered = await utils.canned.render.fetch({ id, shop });
      onSelect(rendered.body);
    } catch {
      const fallback = replies.find((r) => r.id === id);
      if (fallback) onSelect(fallback.body);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="apoaap-slash-command-popover"
      style={{
        position: "absolute",
        bottom: "calc(100% + 6px)",
        left: "12px",
        width: "360px",
        maxHeight: "260px",
        overflowY: "auto",
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        borderRadius: "8px",
        boxShadow: "var(--cp-shadow-elevated)",
        zIndex: 50,
        padding: "4px",
      }}
      role="listbox"
      aria-label="Canned replies autocomplete"
    >
      <div
        style={{
          padding: "4px 8px 6px",
          borderBottom: "1px solid var(--cp-border)",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--cp-text-muted)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={{ color: "var(--cp-accent)" }}>CANNED REPLIES ({filtered.length})</span>
        <span style={{ fontSize: "10px", color: "var(--cp-text-subtle)" }}>↑↓ navigate · ↵ select · esc dismiss</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: "12px 8px", textAlign: "center", fontSize: "12px", color: "var(--cp-text-muted)" }}>
          No matching canned replies for "{query}"
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "4px" }}>
          {filtered.map((r, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  background: isSelected
                    ? "var(--cp-accent-subtle)"
                    : "transparent",
                  border: isSelected
                    ? "1px solid var(--cp-accent)"
                    : "1px solid transparent",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.1s ease",
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => void handlePick(r.id)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontWeight: 700,
                      fontSize: "12px",
                      color: "var(--cp-accent)",
                    }}
                  >
                    {r.shortcut}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "var(--cp-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.title}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--cp-text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    width: "100%",
                    marginTop: "2px",
                  }}
                >
                  {r.body.replace(/\n/g, " ")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
