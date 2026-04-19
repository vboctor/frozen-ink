import { useEffect, useRef, useCallback } from "react";
import hljs from "highlight.js";

const WIKILINK_PREFIX = "#wikilink/";

interface HtmlViewProps {
  html: string;
  onWikilinkClick?: (target: string, openNewTab?: boolean) => void;
}

export default function HtmlView({ html, onWikilinkClick }: HtmlViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = 0;

    // Format ISO dates using the user's local timezone and locale
    for (const el of containerRef.current.querySelectorAll<HTMLElement>(".rss-date[data-iso]")) {
      const d = new Date(el.dataset.iso!);
      if (!isNaN(d.getTime())) {
        el.textContent = d.toLocaleString(undefined, {
          year: "numeric", month: "long", day: "numeric",
          hour: "numeric", minute: "2-digit",
        });
      }
    }

    // Apply syntax highlighting to all code blocks
    const codeBlocks = containerRef.current.querySelectorAll("pre code");
    for (const block of codeBlocks) {
      hljs.highlightElement(block as HTMLElement);
    }
  }, [html]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;

      const href = target.getAttribute("href");
      if (!href?.startsWith(WIKILINK_PREFIX)) return;

      e.preventDefault();
      const path = decodeURIComponent(href.slice(WIKILINK_PREFIX.length));
      onWikilinkClick?.(path, e.metaKey || e.ctrlKey);
    },
    [onWikilinkClick],
  );

  return (
    <article className="html-view">
      <div
        ref={containerRef}
        className="html-view-content"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
