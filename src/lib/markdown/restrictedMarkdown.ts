/**
 * Restricted Markdown → structured nodes.
 *
 * Administrator-entered onboarding content is rendered on an UNAUTHENTICATED
 * page, so it is treated as hostile input. This parser never produces HTML: it
 * produces a small tree of typed nodes that React renders as text, so raw
 * markup (`<script>`, `<iframe>`, `<svg onload=…>`, event handlers) can only
 * ever appear as visible characters. `dangerouslySetInnerHTML` is never used.
 *
 * Supported: paragraphs, bold, italic, unordered/ordered lists, links.
 * Link hrefs are restricted to `http://` and `https://` — every other scheme
 * (`javascript:`, `data:`, `vbscript:`, protocol-relative) is dropped and the
 * link degrades to plain text.
 */
export type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] };

const MAX_LENGTH = 4000;

/** Returns a safe absolute http(s) URL, or null when the href must be dropped. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || /[\s<>"']/.test(href)) return null;
  // Reject control characters and encoded newlines used to smuggle schemes.
  if ([...href].some((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp <= 0x1f || cp === 0x7f;
  })) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

function parseInline(raw: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = raw;
  const pattern = /\*\*([^*]+)\*\*|(?:\*|_)([^*_]+)(?:\*|_)|\[([^\]\n]+)\]\(([^)\s]+)\)/;
  for (;;) {
    const match = pattern.exec(rest);
    if (!match) break;
    if (match.index > 0) nodes.push({ type: "text", value: rest.slice(0, match.index) });
    if (match[1] !== undefined) {
      nodes.push({ type: "bold", children: parseInline(match[1]) });
    } else if (match[2] !== undefined) {
      nodes.push({ type: "italic", children: parseInline(match[2]) });
    } else {
      const href = safeHref(match[4] ?? "");
      const children = parseInline(match[3] ?? "");
      // An unsafe href degrades to plain text — the label is kept, the link is not.
      nodes.push(href ? { type: "link", href, children } : { type: "text", value: match[3] ?? "" });
    }
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest) nodes.push({ type: "text", value: rest });
  return nodes;
}

export function parseRestrictedMarkdown(source: string | null | undefined): BlockNode[] {
  if (!source) return [];
  const text = source.slice(0, MAX_LENGTH).replace(/\r\n?/g, "\n");
  const blocks: BlockNode[] = [];
  let list: { ordered: boolean; items: InlineNode[][] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = !!ordered;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(parseInline((bullet?.[1] ?? ordered?.[1] ?? "").trim()));
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Flatten to plain text — used by regression tests and previews. */
export function blocksToText(blocks: readonly BlockNode[]): string {
  const inline = (nodes: readonly InlineNode[]): string =>
    nodes
      .map((n) => (n.type === "text" ? n.value : inline(n.children)))
      .join("");
  return blocks
    .map((b) => (b.type === "paragraph" ? inline(b.children) : b.items.map(inline).join("\n")))
    .join("\n");
}

/** Every href that survived sanitisation — asserted by the security tests. */
export function collectHrefs(blocks: readonly BlockNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly InlineNode[]) => {
    for (const n of nodes) {
      if (n.type === "link") {
        out.push(n.href);
        walk(n.children);
      } else if (n.type !== "text") {
        walk(n.children);
      }
    }
  };
  for (const b of blocks) {
    if (b.type === "paragraph") walk(b.children);
    else b.items.forEach(walk);
  }
  return out;
}
