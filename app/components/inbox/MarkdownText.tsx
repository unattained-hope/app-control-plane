import React from "react";

function sanitizeUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Tokenizes inline Markdown:
 * - Code: `code`
 * - Links: [text](url)
 * - Raw URLs: https://...
 * - Bold + Italic: ***text*** or ___text___
 * - Bold: **text** or __text__
 * - Italic: *text* or _text_
 * - Strikethrough: ~~text~~
 */
export function renderInlineTokens(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  const inlineRegex =
    /(?:`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<]+[^<.,:;"')\]\s])|(?<!\*)\*\*\*(.+?)\*\*\*(?!\*)|(?<!_)___(.+?)___(?!_)|(?<!\*)\*\*(.+?)\*\*(?!\*)|(?<!_)__(.+?)__(?!_)|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)|~~(.+?)~~)/;

  while (remaining.length > 0) {
    const match = remaining.match(inlineRegex);
    if (!match || match.index === undefined) {
      tokens.push(remaining);
      break;
    }

    if (match.index > 0) {
      tokens.push(remaining.substring(0, match.index));
    }

    const fullMatch = match[0];
    const matchIdx = match.index;

    const [
      ,
      codeContent,
      linkText,
      linkUrlRaw,
      rawUrl,
      boldItalicAsterisk,
      boldItalicUnder,
      boldAsterisk,
      boldUnder,
      italicAsterisk,
      italicUnder,
      strikeContent,
    ] = match;

    const boldItalicContent = boldItalicAsterisk || boldItalicUnder;
    const boldContent = boldAsterisk || boldUnder;
    const italicContent = italicAsterisk || italicUnder;

    if (codeContent !== undefined) {
      tokens.push(
        <code
          key={keyIdx++}
          style={{
            background: "var(--cp-surface-2, rgba(255,255,255,0.1))",
            padding: "0.15rem 0.35rem",
            borderRadius: "0.25rem",
            fontSize: "0.85em",
            fontFamily: "monospace",
          }}
        >
          {codeContent}
        </code>,
      );
    } else if (linkText !== undefined && linkUrlRaw !== undefined) {
      const linkUrl = sanitizeUrl(linkUrlRaw);
      if (linkUrl) {
        tokens.push(
          <a
            key={keyIdx++}
            href={linkUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              color: "var(--cp-accent, #3b82f6)",
              textDecoration: "underline",
              wordBreak: "break-all",
            }}
          >
            {linkText}
          </a>,
        );
      } else {
        tokens.push(`[${linkText}](${linkUrlRaw})`);
      }
    } else if (rawUrl !== undefined) {
      const cleanUrl = sanitizeUrl(rawUrl);
      if (cleanUrl) {
        tokens.push(
          <a
            key={keyIdx++}
            href={cleanUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              color: "var(--cp-accent, #3b82f6)",
              textDecoration: "underline",
              wordBreak: "break-all",
            }}
          >
            {rawUrl}
          </a>,
        );
      } else {
        tokens.push(rawUrl);
      }
    } else if (boldItalicContent !== undefined) {
      tokens.push(
        <strong key={keyIdx++}>
          <em>{renderInlineTokens(boldItalicContent)}</em>
        </strong>,
      );
    } else if (boldContent !== undefined) {
      tokens.push(<strong key={keyIdx++}>{renderInlineTokens(boldContent)}</strong>);
    } else if (italicContent !== undefined) {
      tokens.push(<em key={keyIdx++}>{renderInlineTokens(italicContent)}</em>);
    } else if (strikeContent !== undefined) {
      tokens.push(<del key={keyIdx++}>{renderInlineTokens(strikeContent)}</del>);
    }

    remaining = remaining.substring(matchIdx + fullMatch.length);
  }

  return tokens;
}

export function MarkdownText({ content }: { readonly content: string }) {
  if (!content) return null;

  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let blockIdx = 0;

  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  function flushList() {
    if (listItems.length > 0 && listType) {
      const items = listItems;
      const type = listType;
      const isUl = type === "ul";
      blocks.push(
        isUl ? (
          <ul
            key={blockIdx++}
            style={{
              paddingLeft: "1.25rem",
              margin: "0.35rem 0",
              listStyleType: "disc",
            }}
          >
            {items.map((item, i) => (
              <li key={i} style={{ margin: "0.15rem 0" }}>
                {renderInlineTokens(item)}
              </li>
            ))}
          </ul>
        ) : (
          <ol
            key={blockIdx++}
            style={{
              paddingLeft: "1.25rem",
              margin: "0.35rem 0",
              listStyleType: "decimal",
            }}
          >
            {items.map((item, i) => (
              <li key={i} style={{ margin: "0.15rem 0" }}>
                {renderInlineTokens(item)}
              </li>
            ))}
          </ol>
        ),
      );
      listItems = [];
      listType = null;
    }
  }

  function flushCodeBlock() {
    if (codeBlockLines.length > 0) {
      const code = codeBlockLines.join("\n");
      blocks.push(
        <pre
          key={blockIdx++}
          style={{
            background: "var(--cp-surface-2)",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            overflowX: "auto",
            margin: "0.4rem 0",
            fontSize: "0.82rem",
            fontFamily: "monospace",
            lineHeight: 1.45,
            border: "1px solid var(--cp-border)",
          }}
        >
          <code>{code}</code>
        </pre>,
      );
      codeBlockLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const line = rawLine;

    // Check code fence
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Bullet lists
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch && ulMatch[2]) {
      if (listType === "ol") flushList();
      listType = "ul";
      listItems.push(ulMatch[2]);
      continue;
    }

    // Numbered lists
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch && olMatch[2]) {
      if (listType === "ul") flushList();
      listType = "ol";
      listItems.push(olMatch[2]);
      continue;
    }

    // End list if we hit non-list line
    flushList();

    // Headers
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match && h1Match[1]) {
      blocks.push(
        <h3 key={blockIdx++} style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0.5rem 0 0.25rem" }}>
          {renderInlineTokens(h1Match[1])}
        </h3>,
      );
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match && h2Match[1]) {
      blocks.push(
        <h4 key={blockIdx++} style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0.4rem 0 0.2rem" }}>
          {renderInlineTokens(h2Match[1])}
        </h4>,
      );
      continue;
    }

    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match && h3Match[1]) {
      blocks.push(
        <h5 key={blockIdx++} style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0.35rem 0 0.15rem" }}>
          {renderInlineTokens(h3Match[1])}
        </h5>,
      );
      continue;
    }

    // Blockquote
    const quoteMatch = line.match(/^>\s*(.+)$/);
    if (quoteMatch && quoteMatch[1]) {
      blocks.push(
        <blockquote
          key={blockIdx++}
          style={{
            borderLeft: "3px solid var(--cp-accent)",
            paddingLeft: "0.625rem",
            margin: "0.35rem 0",
            color: "var(--cp-text-muted)",
            fontStyle: "italic",
          }}
        >
          {renderInlineTokens(quoteMatch[1])}
        </blockquote>
      );
      continue;
    }

    // Empty line / paragraph break
    if (!line.trim()) {
      blocks.push(<div key={blockIdx++} style={{ height: "0.35rem" }} />);
      continue;
    }

    // Normal paragraph line
    blocks.push(
      <p key={blockIdx++} style={{ margin: "0.2rem 0", lineHeight: 1.45 }}>
        {renderInlineTokens(line)}
      </p>,
    );
  }

  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushList();

  return <div className="apoaap-markdown-body">{blocks}</div>;
}
