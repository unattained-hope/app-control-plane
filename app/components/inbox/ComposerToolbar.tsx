import React from "react";
import { Bold, Italic, Link as LinkIcon, Code, List, Terminal, Paperclip } from "lucide-react";

export interface ComposerToolbarProps {
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly value: string;
  readonly onChange: (nextValue: string) => void;
  readonly onAttachClick?: () => void;
  readonly onSlashClick?: () => void;
  readonly disabled?: boolean;
}

export function ComposerToolbar({
  textareaRef,
  value,
  onChange,
  onAttachClick,
  onSlashClick,
  disabled = false,
}: ComposerToolbarProps) {
  function applyFormatting(
    prefix: string,
    suffix: string = "",
    defaultText: string = "text",
    block: boolean = false,
  ) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selection = value.substring(start, end);

    let insertion = "";
    let newCursorPos = start;

    if (block) {
      const isStartOfLine = start === 0 || value[start - 1] === "\n";
      const preNewline = isStartOfLine ? "" : "\n";
      const postNewline = end === value.length || value[end] === "\n" ? "" : "\n";

      if (selection) {
        insertion = `${preNewline}${prefix}${selection}${suffix}${postNewline}`;
        newCursorPos = start + preNewline.length + prefix.length + selection.length + suffix.length;
      } else {
        insertion = `${preNewline}${prefix}${defaultText}${suffix}${postNewline}`;
        newCursorPos = start + preNewline.length + prefix.length;
      }
    } else {
      if (selection) {
        insertion = `${prefix}${selection}${suffix}`;
        newCursorPos = start + prefix.length + selection.length + suffix.length;
      } else {
        insertion = `${prefix}${defaultText}${suffix}`;
        newCursorPos = start + prefix.length;
      }
    }

    const nextValue = value.substring(0, start) + insertion + value.substring(end);
    onChange(nextValue);

    // Re-focus and set cursor position after render
    setTimeout(() => {
      textarea.focus();
      if (!selection) {
        textarea.setSelectionRange(newCursorPos, newCursorPos + defaultText.length);
      } else {
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }

  function handleLink() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selection = value.substring(start, end) || "link text";
    const insertion = `[${selection}](https://)`;
    const nextValue = value.substring(0, start) + insertion + value.substring(end);
    onChange(nextValue);

    setTimeout(() => {
      textarea.focus();
      const urlStart = start + selection.length + 3;
      textarea.setSelectionRange(urlStart, urlStart + 8);
    }, 0);
  }

  const btnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    padding: "0",
    borderRadius: "4px",
    background: "transparent",
    border: "1px solid transparent",
    color: "var(--cp-text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.15s ease",
  };

  return (
    <div
      className="apoaap-inbox-composer-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "4px",
        padding: "4px 8px",
        background: "var(--cp-surface-2)",
        borderTop: "1px solid var(--cp-border)",
        borderBottom: "1px solid var(--cp-border)",
      }}
      role="toolbar"
      aria-label="Text formatting tools"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
        <button
          type="button"
          style={btnStyle}
          className="apoaap-toolbar-btn"
          title="Bold (Ctrl+B)"
          aria-label="Format bold"
          disabled={disabled}
          onClick={() => applyFormatting("**", "**", "bold text")}
        >
          <Bold size={14} />
        </button>
        <button
          type="button"
          style={btnStyle}
          className="apoaap-toolbar-btn"
          title="Italic (Ctrl+I)"
          aria-label="Format italic"
          disabled={disabled}
          onClick={() => applyFormatting("*", "*", "italic text")}
        >
          <Italic size={14} />
        </button>
        <button
          type="button"
          style={btnStyle}
          className="apoaap-toolbar-btn"
          title="Insert Link"
          aria-label="Insert link"
          disabled={disabled}
          onClick={handleLink}
        >
          <LinkIcon size={14} />
        </button>
        <span
          style={{
            width: "1px",
            height: "14px",
            background: "var(--cp-border)",
            margin: "0 3px",
          }}
          aria-hidden
        />
        <button
          type="button"
          style={btnStyle}
          className="apoaap-toolbar-btn"
          title="Inline Code"
          aria-label="Format inline code"
          disabled={disabled}
          onClick={() => applyFormatting("`", "`", "code")}
        >
          <Code size={14} />
        </button>
        <button
          type="button"
          style={btnStyle}
          className="apoaap-toolbar-btn"
          title="Code Block"
          aria-label="Insert code block"
          disabled={disabled}
          onClick={() => applyFormatting("```\n", "\n```", "code block", true)}
        >
          <Terminal size={14} />
        </button>
        <button
          type="button"
          style={btnStyle}
          className="apoaap-toolbar-btn"
          title="Bullet List"
          aria-label="Insert bullet list"
          disabled={disabled}
          onClick={() => applyFormatting("- ", "", "item", true)}
        >
          <List size={14} />
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {onSlashClick ? (
          <button
            type="button"
            style={{
              ...btnStyle,
              width: "auto",
              padding: "0 6px",
              fontSize: "11px",
              fontWeight: 600,
              fontFamily: "monospace",
              color: "var(--cp-accent)",
              background: "var(--cp-accent-subtle)",
              borderRadius: "4px",
            }}
            className="apoaap-toolbar-btn"
            title="Insert Canned Reply (/)"
            aria-label="Open canned replies"
            disabled={disabled}
            onClick={onSlashClick}
          >
            / Canned
          </button>
        ) : null}

        {onAttachClick ? (
          <button
            type="button"
            style={btnStyle}
            className="apoaap-toolbar-btn"
            title="Attach File or Screenshot"
            aria-label="Attach file"
            disabled={disabled}
            onClick={onAttachClick}
          >
            <Paperclip size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
