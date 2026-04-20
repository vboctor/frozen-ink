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

    // Lazy-load text attachment content when a <details> is toggled open.
    // (Scripts injected via dangerouslySetInnerHTML don't execute, so we handle it here.)
    const details = containerRef.current.querySelectorAll<HTMLDetailsElement>(".mt-attachment-text");
    for (const el of details) {
      el.addEventListener("toggle", function onToggle() {
        if (!el.open) return;
        const pre = el.querySelector<HTMLElement>("pre");
        if (!pre || pre.dataset.loaded) return;
        pre.dataset.loaded = "1";
        const url = el.dataset.url;
        if (!url) return;
        fetch(url)
          .then((r) => r.text())
          .then((t) => { pre.textContent = t; })
          .catch(() => { pre.textContent = "(failed to load)"; });
      });
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
