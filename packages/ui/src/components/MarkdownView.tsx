import { useMemo, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

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

  // Rewrite attachment-relative paths to API URLs so they resolve in the
  // web viewer where files aren't on the local filesystem. Accepts both
  // root-relative (`attachments/...`, used by the Evernote crawler) and
  // ancestor-relative (`../attachments/...`, `../../attachments/...`) forms.
  // Both image refs (`![]`) and plain links (`[]`) are rewritten so PDF
  // download links keep working too.
  const attachmentPathRe = /(?:\.\.\/)*attachments\/([^)]+)/;
  content = content.replace(
    new RegExp(`!\\[([^\\]]*)\\]\\((${attachmentPathRe.source})\\)`, "g"),
    (_match, alt: string, _full: string, path: string) =>
      `![${alt}](/api/attachments/${encodeURIComponent(collection)}/${path})`,
  );
  content = content.replace(
    new RegExp(`(?<!!)\\[([^\\]]*)\\]\\((${attachmentPathRe.source})\\)`, "g"),
    (_match, label: string, _full: string, path: string) =>
      `[${label}](/api/attachments/${encodeURIComponent(collection)}/${path})`,
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

  // Convert Obsidian inline hashtags (#Tag) to inline code so the ReactMarkdown
  // code component can render them as styled tag badges.
  // Matches # followed by a letter then word chars — avoids heading syntax which
  // requires a space (# heading) and skips URLs/anchors.
  content = content.replace(
    /(^|\s)(#[A-Za-z][A-Za-z0-9_/-]*)/g,
    (_match, pre: string, tag: string) => `${pre}\`${tag}\``,
  );

  return content;
}

function parseCallout(
  text: string,
): { type: string; title: string; body: string } | null {
  // Accept "[!Type]" (GFM / Obsidian) or "[Type]" (loose shorthand seen in
  // some MantisHub pages). Type is lowercased for lookup.
  // Use [ \t]* (not \s*) so a newline after the marker doesn't get swallowed
  // and the body text accidentally captured as the title.
  const match = text.match(/^\[!?(\w+)\][ \t]*(.*)/);
  if (!match) return null;
  const lines = text.split("\n");
  const body = lines.slice(1).join("\n");
  return { type: match[1].toLowerCase(), title: match[2], body };
}

/** Inline Octicon-style SVG icon for a GFM admonition type. */
function CalloutIcon({ type }: { type: string }) {
  const paths: Record<string, string> = {
    note: "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
    tip: "M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.247-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z",
    important: "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
    warning: "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
    caution: "M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
  };
  const fallbackEmoji: Record<string, string> = {
    info: "ℹ︎",
    danger: "⛔",
    link: "🔗",
    git: "🔀",
  };
  const path = paths[type];
  if (path) {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
        <path d={path} />
      </svg>
    );
  }
  return <span aria-hidden>{fallbackEmoji[type] ?? "📌"}</span>;
}

/**
 * Detect a video-sharing URL written as a markdown image and return embed info.
 * Komodo (kommodo.ai / komododecks.com) is rendered as a clickable play card
 * because their iframe-embed URL is a premium feature with no public pattern.
 */
function videoEmbedFromUrl(url: string): { provider: "komodo" | "loom" | "youtube" | "vimeo"; embedUrl: string; openUrl: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = url.match(/^https?:\/\/(?:www\.)?(?:komododecks\.com|kommodo\.ai)\/recordings\/([\w-]+)/))) {
    const open = `https://kommodo.ai/recordings/${m[1]}`;
    return { provider: "komodo", embedUrl: open, openUrl: open };
  }
  if ((m = url.match(/^https?:\/\/(?:www\.)?loom\.com\/share\/([\w-]+)/))) {
    return { provider: "loom", embedUrl: `https://www.loom.com/embed/${m[1]}`, openUrl: `https://www.loom.com/share/${m[1]}` };
  }
  if ((m = url.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)/)) ||
      (m = url.match(/^https?:\/\/youtu\.be\/([\w-]+)/))) {
    return { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${m[1]}`, openUrl: `https://www.youtube.com/watch?v=${m[1]}` };
  }
  if ((m = url.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/))) {
    return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${m[1]}`, openUrl: `https://vimeo.com/${m[1]}` };
  }
  return null;
}

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
      code({ className, children }) {
        const text = typeof children === "string" ? children : "";
        // Inline code with no language class that looks like a hashtag → tag badge
        if (!className && /^#[A-Za-z]/.test(text) && !text.includes(" ")) {
          return <span className="obs-tag">{text}</span>;
        }
        return <code className={className}>{children}</code>;
      },
      img({ src, alt }) {
        const url = typeof src === "string" ? src : "";
        // Inline PDFs: an `<img>` ref to a `.pdf` is treated as a request to
        // embed the document inline. URL fragment params strip the
        // thumbnail sidebar/bookmark pane and fit-to-width — most browser
        // PDF viewers (Chrome/Edge built-in, pdf.js, Safari) honour these.
        //
        // Use `<iframe>` rather than `<object>` because `<object>` doesn't
        // reliably re-load when React reuses the same DOM node and only
        // swaps the `data` attribute (browsing between two PDF notes was
        // intermittently showing the previous note's PDF — or none at all).
        // `<iframe src=…>` triggers a full navigation; pairing it with a
        // `key` of the URL forces React to unmount + remount on every
        // change, killing any stale viewer state.
        if (/\.pdf(\?|#|$)/i.test(url)) {
          const sep = url.includes("#") ? "&" : "#";
          const viewerUrl = `${url}${sep}navpanes=0&pagemode=none&toolbar=1&zoom=page-width`;
          return (
            <div className="mt-md-pdf-wrap">
              <iframe
                key={viewerUrl}
                src={viewerUrl}
                title={alt || "PDF"}
                className="mt-md-pdf"
              />
              <a
                className="mt-md-pdf-fallback"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {alt || "PDF"} in a new tab
              </a>
            </div>
          );
        }
        const video = url ? videoEmbedFromUrl(url) : null;
        if (video) {
          if (video.provider === "komodo") {
            return (
              <a className="mt-md-video-link" href={video.openUrl} target="_blank" rel="noopener noreferrer">
                <span className="mt-md-video-icon" aria-hidden>▶</span>
                <span className="mt-md-video-label">{alt || "Watch recording"}</span>
              </a>
            );
          }
          return (
            <iframe
              className="mt-md-video"
              src={video.embedUrl}
              title={alt || `${video.provider} video`}
              allowFullScreen
              frameBorder={0}
            />
          );
        }
        return <img src={url} alt={alt} loading="lazy" />;
      },
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
          // Default the title to the type label (e.g. "Note", "Warning") when
          // the syntax doesn't supply one inline.
          const defaultLabel = callout.type.charAt(0).toUpperCase() + callout.type.slice(1);
          const title = callout.title.trim() || defaultLabel;
          return (
            <div className={`callout callout-${callout.type}`}>
              <div className="callout-title">
                <span className="callout-icon"><CalloutIcon type={callout.type} /></span>
                {title}
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
