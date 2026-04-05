interface LinkItem {
  title: string;
  markdownPath: string | null;
}

interface Backlink {
  entityId: number;
  externalId: string;
  entityType: string;
  title: string;
  markdownPath: string | null;
}

interface LinksPanelProps {
  backlinks: Backlink[];
  outgoingLinks: LinkItem[];
  open: boolean;
  onNavigate: (markdownPath: string) => void;
}

// Chain link with arrow pointing in (backlinks / incoming)
function IncomingLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      <polyline points="11 17 8 20 5 17"/>
      <line x1="8" y1="12" x2="8" y2="20"/>
    </svg>
  );
}

// Chain link with arrow pointing out (outgoing links)
function OutgoingLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      <polyline points="13 7 16 4 19 7"/>
      <line x1="16" y1="4" x2="16" y2="12"/>
    </svg>
  );
}

function LinkSection({
  icon,
  label,
  items,
  onNavigate,
}: {
  icon: React.ReactNode;
  label: string;
  items: LinkItem[];
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="links-section">
      <div className="links-section-header">
        <span className="links-section-icon">{icon}</span>
        <span className="links-section-title">{label}</span>
        {items.length > 0 && (
          <span className="backlinks-count">{items.length}</span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="backlinks-empty">None</div>
      ) : (
        <ul className="backlinks-list">
          {items.map((item, i) => (
            <li key={i}>
              <button
                className="backlink-item"
                onClick={() => { if (item.markdownPath) onNavigate(item.markdownPath); }}
                disabled={!item.markdownPath}
              >
                <span className="backlink-title">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LinksPanel({ backlinks, outgoingLinks, open, onNavigate }: LinksPanelProps) {
  if (!open) return null;

  const sortedBacklinks: LinkItem[] = [...backlinks]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((bl) => ({
      title: bl.title,
      markdownPath: bl.markdownPath ? bl.markdownPath.replace(/^markdown\//, "") : null,
    }));

  return (
    <div className="backlinks-panel">
      <div className="backlinks-header">
        <span className="backlinks-title">Links</span>
      </div>
      <LinkSection
        icon={<IncomingLinkIcon />}
        label="Backlinks"
        items={sortedBacklinks}
        onNavigate={onNavigate}
      />
      <LinkSection
        icon={<OutgoingLinkIcon />}
        label="Outgoing"
        items={outgoingLinks}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export type { Backlink, LinkItem };
