import { useMemo, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const WIKILINK_PREFIX = "#wikilink/";

interface MarkdownViewProps {
  content: string;
  collection: string;
  allFiles: string[];
  onWikilinkClick: (target: string, openNewTab?: boolean) => void;
}

function preprocessMarkdown(raw: string, collection: string): string {
  let content = raw;

  // Strip frontmatter
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex !== -1) {
      content = content.slice(endIndex + 3).trimStart();
    }
  }

  // Replace image embeds: ![[path]] → ![path](/api/attachments/collection/path)
  content = content.replace(
    /!\[\[([^\]]+)\]\]/g,
    (_match, path: string) =>
      `![${path}](/api/attachments/${encodeURIComponent(collection)}/${path})`,
  );

  // Replace wikilinks: [[target|label]] → [label](#wikilink/encoded-target)
  // and [[target]] → [target](#wikilink/encoded-target)
  // encodeURIComponent ensures spaces and special chars survive the URL round-trip.
  content = content.replace(
    /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
    (_match, target: string, label: string) =>
      `[${label}](${WIKILINK_PREFIX}${encodeURIComponent(target)})`,
  );
  content = content.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, target: string) => {
      const label = target.includes("/") ? target.split("/").pop()! : target;
      return `[${label}](${WIKILINK_PREFIX}${encodeURIComponent(target)})`;
    },
  );

  return content;
}

function parseCallout(
  text: string,
): { type: string; title: string; body: string } | null {
  const match = text.match(/^\[!(\w+)\]\s*(.*)/);
  if (!match) return null;
  const lines = text.split("\n");
  const body = lines.slice(1).join("\n");
  return { type: match[1], title: match[2], body };
}

const CALLOUT_ICONS: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  danger: "🚨",
  tip: "💡",
  note: "📝",
  link: "🔗",
  git: "🔀",
};

function resolveWikilink(target: string, allFiles: string[]): string | null {
  const directPath = target.endsWith(".md") ? target : `${target}.md`;
  if (allFiles.includes(directPath)) return directPath;
  const stem = directPath.includes("/") ? directPath.split("/").pop()! : directPath;
  const match = allFiles.find((f) => f === stem || f.endsWith(`/${stem}`));
  return match ?? null;
}

export default function MarkdownView({
  content,
  collection,
  allFiles,
  onWikilinkClick,
}: MarkdownViewProps) {
  const processed = useMemo(
    () => preprocessMarkdown(content, collection),
    [content, collection],
  );

  const components: ComponentProps<typeof ReactMarkdown>["components"] = useMemo(
    () => ({
      a({ href, children }) {
        if (href?.startsWith(WIKILINK_PREFIX)) {
          const target = decodeURIComponent(href.slice(WIKILINK_PREFIX.length));
          const resolved = resolveWikilink(target, allFiles);
          if (!resolved) {
            return <span className="wikilink-missing">{children}</span>;
          }
          return (
            <a
              href="#"
              className="wikilink"
              onClick={(e) => {
                e.preventDefault();
                onWikilinkClick(target, e.metaKey || e.ctrlKey);
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a href={href} className="external-link" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
      blockquote({ children }) {
        // Extract text content from children to detect callout syntax
        const childArray = Array.isArray(children) ? children : [children];
        let textContent = "";
        for (const child of childArray) {
          if (typeof child === "string") {
            textContent += child;
          } else if (child && typeof child === "object" && "props" in child) {
            const props = child.props as { children?: unknown };
            if (typeof props.children === "string") {
              textContent += props.children;
            } else if (Array.isArray(props.children)) {
              textContent += props.children
                .filter((c: unknown) => typeof c === "string")
                .join("");
            }
          }
        }

        const callout = parseCallout(textContent.trim());
        if (callout) {
          const icon = CALLOUT_ICONS[callout.type] || "📌";
          return (
            <div className={`callout callout-${callout.type}`}>
              <div className="callout-title">
                <span className="callout-icon">{icon}</span>
                {callout.title}
              </div>
              {callout.body && (
                <div className="callout-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {callout.body}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          );
        }

        return <blockquote>{children}</blockquote>;
      },
    }),
    [onWikilinkClick, allFiles],
  );

  return (
    <article className="markdown-view">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </article>
  );
}
