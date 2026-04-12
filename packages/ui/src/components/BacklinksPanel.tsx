interface Backlink {
  entityId: number;
  externalId: string;
  entityType: string;
  title: string;
  markdownPath: string | null;
}

interface BacklinksPanelProps {
  backlinks: Backlink[];
  open: boolean;
  onNavigate: (markdownPath: string) => void;
}

export default function BacklinksPanel({ backlinks, open, onNavigate }: BacklinksPanelProps) {
  if (!open) return null;

  return (
    <div className="backlinks-panel">
      <div className="backlinks-header">
        <svg className="backlinks-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          <polyline points="11 17 8 20 5 17"/>
          <line x1="8" y1="12" x2="8" y2="20"/>
        </svg>
        <span className="backlinks-title">Backlinks</span>
        {backlinks.length > 0 && (
          <span className="backlinks-count">{backlinks.length}</span>
        )}
      </div>
      {backlinks.length === 0 ? (
        <div className="backlinks-empty">No backlinks</div>
      ) : (
        <ul className="backlinks-list">
          {[...backlinks].sort((a, b) => a.title.localeCompare(b.title)).map((bl) => (
            <li key={bl.entityId}>
              <button
                className="backlink-item"
                onClick={() => {
                  if (bl.markdownPath) {
                    const path = bl.markdownPath.replace(/^content\//, "");
                    onNavigate(path);
                  }
                }}
                disabled={!bl.markdownPath}
              >
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
