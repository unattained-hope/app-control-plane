import { describe, it, expect } from "vitest";
import {
  markdownToHtml,
  domToMarkdown,
  htmlToMarkdown,
  formatInlineMarkdown,
  type MinimalDomNode,
} from "~/components/inbox/richTextConverter.js";

describe("richTextConverter", () => {
  it("converts bold and italic markdown to HTML", () => {
    const md = "**bold text** and *italic text*";
    const html = markdownToHtml(md);
    expect(html).toContain("<strong>bold text</strong>");
    expect(html).toContain("<em>italic text</em>");
  });

  it("converts inline code and links to HTML", () => {
    const md = "Run `npm test` or visit [Shopify](https://shopify.com)";
    const html = markdownToHtml(md);
    expect(html).toContain("npm test");
    expect(html).toContain('href="https://shopify.com"');
    expect(html).toContain(">Shopify</a>");
  });

  it("converts bullet lists to HTML", () => {
    const md = "- Item 1\n- Item 2";
    const html = markdownToHtml(md);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item 1</li>");
    expect(html).toContain("<li>Item 2</li>");
    expect(html).toContain("</ul>");
  });

  it("converts DOM nodes with bold / italic back to clean markdown", () => {
    const mockNode: MinimalDomNode = {
      nodeType: 1,
      tagName: "div",
      childNodes: [
        {
          nodeType: 1,
          tagName: "strong",
          childNodes: [{ nodeType: 3, nodeValue: "bold text" }],
        },
        { nodeType: 3, nodeValue: " and " },
        {
          nodeType: 1,
          tagName: "em",
          childNodes: [{ nodeType: 3, nodeValue: "italic text" }],
        },
      ],
    };
    const md = domToMarkdown(mockNode);
    expect(md.trim()).toBe("**bold text** and *italic text*");
  });

  it("converts DOM nodes with code and links back to clean markdown", () => {
    const mockNode: MinimalDomNode = {
      nodeType: 1,
      tagName: "div",
      childNodes: [
        {
          nodeType: 1,
          tagName: "code",
          childNodes: [{ nodeType: 3, nodeValue: "const x = 1;" }],
        },
        { nodeType: 3, nodeValue: " and " },
        {
          nodeType: 1,
          tagName: "a",
          getAttribute: (attr) => (attr === "href" ? "https://example.com" : null),
          childNodes: [{ nodeType: 3, nodeValue: "Example" }],
        },
      ],
    };
    const md = domToMarkdown(mockNode);
    expect(md.trim()).toBe("`const x = 1;` and [Example](https://example.com)");
  });

  it("converts html to markdown cleanly", () => {
    const html = "<div><strong>Hello</strong> <em>World</em></div>";
    expect(htmlToMarkdown(html).trim()).toBe("**Hello** *World*");
  });

  it("handles empty and line break conversions cleanly", () => {
    expect(markdownToHtml("")).toBe("");
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("<div><br></div>")).toBe("");
  });
});
