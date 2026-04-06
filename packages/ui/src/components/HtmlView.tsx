import { useEffect, useRef } from "react";

interface HtmlViewProps {
  html: string;
}

export default function HtmlView({ html }: HtmlViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Scroll to top when content changes
    containerRef.current.scrollTop = 0;
  }, [html]);

  return (
    <article className="html-view">
      <div
        ref={containerRef}
        className="html-view-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
