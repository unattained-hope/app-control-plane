/**
 * Utilities to convert between Markdown and HTML for WYSIWYG rich text chat editors.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Converts Markdown string into clean HTML for contenteditable rendering.
 */
export function markdownToHtml(md: string): string {
  if (!md) return "";

  const lines = md.split("\n");
  const htmlLines: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const listMatch = rawLine.match(/^(\s*)[-*+]\s+(.+)$/);

    if (listMatch && listMatch[2]) {
      if (!inList) {
        htmlLines.push("<ul>");
        inList = true;
      }
      const itemContent = formatInlineMarkdown(listMatch[2]);
      htmlLines.push(`<li>${itemContent}</li>`);
      continue;
    }

    if (inList) {
      htmlLines.push("</ul>");
      inList = false;
    }

    if (!rawLine.trim()) {
      htmlLines.push("<div><br></div>");
    } else {
      const lineHtml = formatInlineMarkdown(rawLine);
      htmlLines.push(`<div>${lineHtml}</div>`);
    }
  }

  if (inList) {
    htmlLines.push("</ul>");
  }

  return htmlLines.join("");
}

export function formatInlineMarkdown(text: string): string {
  let escaped = escapeHtml(text);

  // Inline Code
  escaped = escaped.replace(
    /`([^`]+)`/g,
    '<code style="background:var(--cp-surface-2, rgba(255,255,255,0.1));padding:0.1rem 0.3rem;border-radius:3px;font-family:monospace;font-size:0.9em;">$1</code>',
  );

  // Bold + Italic (***text*** or ___text___)
  escaped = escaped.replace(/(?<!\*)\*\*\*(.+?)\*\*\*(?!\*)/g, "<strong><em>$1</em></strong>");
  escaped = escaped.replace(/(?<!_)___(.+?)___(?!_)/g, "<strong><em>$1</em></strong>");

  // Bold (**text** or __text__)
  escaped = escaped.replace(/(?<!\*)\*\*(.+?)\*\*(?!\*)/g, "<strong>$1</strong>");
  escaped = escaped.replace(/(?<!_)__(.+?)__(?!_)/g, "<strong>$1</strong>");

  // Italic (*text* or _text_)
  escaped = escaped.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  escaped = escaped.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");

  // Strikethrough (~~text~~)
  escaped = escaped.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Links [text](url)
  escaped = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" style="color:var(--cp-accent, #3b82f6);text-decoration:underline;">$1</a>',
  );

  return escaped;
}

export interface MinimalDomNode {
  nodeType: number;
  nodeValue?: string | null;
  childNodes?: MinimalDomNode[];
  tagName?: string;
  style?: Record<string, string>;
  getAttribute?: (attr: string) => string | null;
}

/**
 * Converts DOM elements inside contenteditable editor into clean Markdown.
 */
export function domToMarkdown(node: MinimalDomNode | Node): string {
  if (node.nodeType === 3) {
    // TEXT_NODE
    return (node as Node).nodeValue || (node as MinimalDomNode).nodeValue || "";
  }

  if (node.nodeType !== 1) {
    // Not an ELEMENT_NODE
    return "";
  }

  const el = node as HTMLElement;
  const tag = (el.tagName || "").toLowerCase();

  // Child text / content
  let inner = "";
  const children = el.childNodes || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child) {
      inner += domToMarkdown(child as never);
    }
  }

  const styleObj = el.style || {};
  const isBold =
    tag === "b" ||
    tag === "strong" ||
    styleObj.fontWeight === "bold" ||
    parseInt(styleObj.fontWeight || "0", 10) >= 600;

  const isItalic =
    tag === "i" ||
    tag === "em" ||
    styleObj.fontStyle === "italic";

  const isStrike =
    tag === "s" ||
    tag === "strike" ||
    tag === "del" ||
    (typeof styleObj.textDecoration === "string" && styleObj.textDecoration.includes("line-through"));

  let formatted = inner;

  if (tag === "code") {
    formatted = `\`${formatted}\``;
  } else if (tag === "a") {
    const href = (typeof el.getAttribute === "function" ? el.getAttribute("href") : "") || "";
    if (href) {
      formatted = `[${formatted || href}](${href})`;
    }
  }

  if (isItalic && !formatted.startsWith("*") && !formatted.startsWith("_")) {
    formatted = formatted.trim() ? `*${formatted}*` : "";
  }

  if (isBold && !formatted.startsWith("**") && !formatted.startsWith("__")) {
    formatted = formatted.trim() ? `**${formatted}**` : "";
  }

  if (isStrike && !formatted.startsWith("~~")) {
    formatted = formatted.trim() ? `~~${formatted}~~` : "";
  }

  switch (tag) {
    case "li":
      return `- ${formatted.trim()}\n`;
    case "ul":
    case "ol":
      return formatted.endsWith("\n") ? formatted : `${formatted}\n`;
    case "p":
    case "div":
      if (!formatted || formatted === "\n") return "\n";
      return formatted.endsWith("\n") ? formatted : `${formatted}\n`;
    case "br":
      return "\n";
    default:
      return formatted;
  }
}

/**
 * Cleanly converts an HTML string from contenteditable to markdown.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html === "<br>" || html === "<div><br></div>") return "";
  if (typeof document === "undefined") {
    // Fallback for non-browser environment
    return html
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~")
      .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
      .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "$1\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
  }

  const container = document.createElement("div");
  container.innerHTML = html;
  const md = domToMarkdown(container);
  return md.replace(/\n{3,}/g, "\n\n").trimEnd();
}
