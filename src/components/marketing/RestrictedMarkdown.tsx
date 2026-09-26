import { Fragment, type ReactNode } from "react";
import { parseRestrictedMarkdown, type BlockNode, type InlineNode } from "@/lib/markdown/restrictedMarkdown";

/**
 * Renders restricted Markdown as React elements. No `dangerouslySetInnerHTML`,
 * so administrator-entered content can never execute on the public page.
 */
function renderInline(nodes: readonly InlineNode[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <Fragment key={i}>{node.value}</Fragment>;
      case "bold":
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case "italic":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
          >
            {renderInline(node.children)}
          </a>
        );
      default:
        return null;
    }
  });
}

function renderBlock(block: BlockNode, key: number): ReactNode {
  if (block.type === "paragraph") {
    return (
      <p key={key} className="text-sm leading-relaxed text-muted-foreground">
        {renderInline(block.children)}
      </p>
    );
  }
  const items = block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>);
  return block.ordered ? (
    <ol key={key} className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{items}</ol>
  ) : (
    <ul key={key} className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{items}</ul>
  );
}

export function RestrictedMarkdown({ source, className }: { source: string | null | undefined; className?: string }) {
  const blocks = parseRestrictedMarkdown(source);
  if (blocks.length === 0) return null;
  return <div className={className ? `space-y-3 ${className}` : "space-y-3"}>{blocks.map(renderBlock)}</div>;
}

export default RestrictedMarkdown;
