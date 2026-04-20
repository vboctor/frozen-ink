import { useMemo, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";

const WIKILINK_PREFIX = "#wikilink/";

interface MarkdownViewProps {
  content: string;
  collection: string;
  filePath?: string;
  allFiles: string[];
  onWikilinkClick: (target: string, openNewTab?: boolean) => void;
}

/** Resolve a relative path against a source file path to get a root-relative path. */
function resolveRelativePath(sourcePath: string, target: string): string {
  const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const parts = (sourceDir ? `${sourceDir}/${target}` : target).split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== "." && p !== "") resolved.push(p);
  }
  return resolved.join("/");
}

function preprocessMarkdown(raw: string, collection: string, filePath?: string): string {
  let content = raw;

  // Strip frontmatter
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex !== -1) {
      content = content.slice(endIndex + 3).trimStart();
    }
  }

  // Replace Obsidian image embeds: ![[path]] → ![path](/api/attachments/collection/path)
  // (backward compatibility for Obsidian vault content)
  content = content.replace(
    /!\[\[([^\]]+)\]\]/g,
    (_match, path: string) =>
      `![${path}](/api/attachments/${encodeURIComponent(collection)}/${path})`,
  );

  // Rewrite relative attachment paths (../attachments/... or ../../attachments/...) to API URLs
  // so they resolve in the web viewer where files aren't on the local filesystem.
  // Root-level vault notes produce ../attachments/...; nested notes produce ../../attachments/...
  content = content.replace(
    /!\[([^\]]*)\]\((?:\.\.\/)+attachments\/([^)]+)\)/g,
    (_match, alt: string, path: string) =>
      `![${alt}](/api/attachments/${encodeURIComponent(collection)}/${path})`,
  );

  // Rewrite MantisBT-style relative asset paths: ![alt](assets/filename)
  // The file is stored at content/{dir}/assets/{filename} relative to the collection root.
  if (filePath) {
    const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    content = content.replace(
      /!\[([^\]]*)\]\(assets\/([^)]+)\)/g,
      (_match, alt: string, filename: string) => {
        const storagePath = dir ? `content/${dir}/assets/${filename}` : `content/assets/${filename}`;
        return `![${alt}](/api/collections/${encodeURIComponent(collection)}/file/${storagePath})`;
      },
    );
  }

  // Replace Obsidian wikilinks: [[target|label]] and [[target]]
  // (backward compatibility for Obsidian vault content)
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

  // Rewrite standard internal links: [label](target.md) → [label](#wikilink/target)
  // Resolves relative paths to root-relative targets for navigation.
  // Excludes external URLs, anchors, and already-processed wikilinks.
  content = content.replace(
    /\[([^\]]+)\]\((?!https?:\/\/|mailto:|#)([^)]+)\.md(?:#[^)]*)?\)/g,
    (_match, label: string, rawTarget: string) => {
      let target = rawTarget;
      if (filePath && (target.startsWith("../") || !target.includes("/"))) {
        target = resolveRelativePath(filePath, target);
      }
      return `[${label}](${WIKILINK_PREFIX}${encodeURIComponent(target)})`;
    },
  );

  // Convert Obsidian inline hashtags (#Tag) to styled spans.
  // Matches # followed by word characters (no space), not at the start of a line
  // (which would be a heading). Skips tags inside code spans/blocks.
  content = content.replace(
    /(^|\s)(#[A-Za-z][A-Za-z0-9_/-]*)/g,
    (_match, pre: string, tag: string) =>
      `${pre}<span class="obs-tag">${tag}</span>`,
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
  filePath,
  allFiles,
  onWikilinkClick,
}: MarkdownViewProps) {
  const processed = useMemo(
    () => preprocessMarkdown(content, collection, filePath),
    [content, collection, filePath],
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
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </article>
  );
}
