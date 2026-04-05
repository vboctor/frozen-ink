import { useState } from "react";

interface Backlink {
  entityId: number;
  externalId: string;
  entityType: string;
  title: string;
  markdownPath: string | null;
}

interface BacklinksPanelProps {
  backlinks: Backlink[];
  onNavigate: (markdownPath: string) => void;
}

export default function BacklinksPanel({ backlinks, onNavigate }: BacklinksPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (backlinks.length === 0) return null;

  return (
    <div className={`backlinks-panel${expanded ? "" : " collapsed"}`}>
      <button
        className="backlinks-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="backlinks-chevron">{expanded ? "◀" : "▶"}</span>
        <span className="backlinks-title">
          Backlinks
        </span>
        <span className="backlinks-count">{backlinks.length}</span>
      </button>
      {expanded && (
        <ul className="backlinks-list">
          {backlinks.map((bl) => (
            <li key={bl.entityId}>
              <button
                className="backlink-item"
                onClick={() => {
                  if (bl.markdownPath) {
                    // Strip the "md/" prefix if present to get the relative path
                    const path = bl.markdownPath.replace(/^md\//, "");
                    onNavigate(path);
                  }
                }}
                disabled={!bl.markdownPath}
              >
                <span className="backlink-type">{bl.entityType}</span>
                <span className="backlink-title">{bl.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type { Backlink };
