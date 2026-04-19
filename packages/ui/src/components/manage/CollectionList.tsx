import { useState, useEffect } from "react";
import SyncProgress from "./SyncProgress";
import { formatTimestamp, type Collection, type CollectionStatus } from "../../types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb % 1 === 0 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb % 1 < 0.05 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

const CRAWLER_LABELS: Record<string, string> = {
  github: "GitHub",
  obsidian: "Obsidian",
  git: "Git",
  mantishub: "MantisHub",
  rss: "RSS/Atom",
  remote: "Cloned",
};

function CrawlerIcon({ type }: { type: string }) {
  const size = 14;
  switch (type) {
    case "github":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
        </svg>
      );
    case "obsidian":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
          <path d="M19.355 18.538a68.967 68.959 0 0 0 1.858-2.954.81.81 0 0 0-.062-.9c-.516-.685-1.504-2.075-2.042-3.362-.553-1.321-.636-3.375-.64-4.377a1.707 1.707 0 0 0-.358-1.05l-3.198-4.064a3.744 3.744 0 0 1-.076.543c-.106.503-.307 1.004-.536 1.5-.134.29-.29.6-.446.914l-.31.626c-.516 1.068-.997 2.227-1.132 3.59-.124 1.26.046 2.73.815 4.481.128.011.257.025.386.044a6.363 6.363 0 0 1 3.326 1.505c.916.79 1.744 1.922 2.415 3.5zM8.199 22.569c.073.012.146.02.22.02.78.024 2.095.092 3.16.29.87.16 2.593.64 4.01 1.055 1.083.316 2.198-.548 2.355-1.664.114-.814.33-1.735.725-2.58l-.01.005c-.67-1.87-1.522-3.078-2.416-3.849a5.295 5.295 0 0 0-2.778-1.257c-1.54-.216-2.952.19-3.84.45.532 2.218.368 4.829-1.425 7.531zM5.533 9.938c-.023.1-.056.197-.098.29L2.82 16.059a1.602 1.602 0 0 0 .313 1.772l4.116 4.24c2.103-3.101 1.796-6.02.836-8.3-.728-1.73-1.832-3.081-2.55-3.831zM9.32 14.01c.615-.183 1.606-.465 2.745-.534-.683-1.725-.848-3.233-.716-4.577.154-1.552.7-2.847 1.235-3.95.113-.235.223-.454.328-.664.149-.297.288-.577.419-.86.217-.47.379-.885.46-1.27.08-.38.08-.72-.014-1.043-.095-.325-.297-.675-.68-1.06a1.6 1.6 0 0 0-1.475.36l-4.95 4.452a1.602 1.602 0 0 0-.513.952l-.427 2.83c.672.59 2.328 2.316 3.335 4.711.09.21.175.43.253.653z"/>
        </svg>
      );
    case "mantishub":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
          <path d="M14,12H10V10H14M14,16H10V14H14M20,8H17.19C16.74,7.22 16.12,6.55 15.37,6.04L17,4.41L15.59,3L13.42,5.17C12.96,5.06 12.5,5 12,5C11.5,5 11.04,5.06 10.59,5.17L8.41,3L7,4.41L8.62,6.04C7.88,6.55 7.26,7.22 6.81,8H4V10H6.09C6.04,10.33 6,10.66 6,11V12H4V14H6V15C6,15.34 6.04,15.67 6.09,16H4V18H6.81C7.85,19.79 9.78,21 12,21C14.22,21 16.15,19.79 17.19,18H20V16H17.91C17.96,15.67 18,15.34 18,15V14H20V12H18V11C18,10.66 17.96,10.33 17.91,10H20V8Z"/>
        </svg>
      );
    case "git":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
          <path d="M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187"/>
        </svg>
      );
    case "remote":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
          <path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>
        </svg>
      );
    case "rss":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
          <circle cx="6" cy="18" r="2.2" />
          <path d="M4 10a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z" />
          <path d="M4 4a16 16 0 0 1 16 16h-3A13 13 0 0 0 4 7z" />
        </svg>
      );
    default:
      return null;
  }
}

interface CollectionListProps {
  onSelect: (name: string) => void;
  onAdd: () => void;
  onSyncComplete?: () => void;
  onCollectionsChanged?: () => void;
}

export default function CollectionList({ onSelect, onAdd, onSyncComplete, onCollectionsChanged }: CollectionListProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [statuses, setStatuses] = useState<Record<string, CollectionStatus>>({});
  const [syncing, setSyncing] = useState(false);

  const load = () => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then((data: Collection[]) => {
        setCollections(data);
        for (const col of data) {
          loadStatus(col.name);
        }
      })
      .catch(console.error);
  };

  const loadStatus = (name: string) => {
    fetch(`/api/collections/${encodeURIComponent(name)}/status`)
      .then((r) => r.json())
      .then((status: CollectionStatus) => {
        setStatuses((prev) => ({ ...prev, [name]: status }));
      })
      .catch(() => {});
  };

  useEffect(load, []);

  const syncAll = (full: boolean) => {
    setSyncing(true);
    fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full }),
    }).catch(console.error);
  };

  const handleSyncComplete = () => {
    setSyncing(false);
    for (const col of collections) {
      loadStatus(col.name);
    }
    onSyncComplete?.();
    onCollectionsChanged?.();
  };

  return (
    <div className="manage-panel">
      <div className="manage-panel-header">
        <h2>Collections</h2>
        <div className="sync-actions">
          <button className="btn btn-sm" onClick={() => syncAll(false)} disabled={syncing}>
            Sync All
          </button>
          <button className="btn btn-primary btn-sm" onClick={onAdd}>
            + Add Collection
          </button>
        </div>
      </div>

      {syncing && <SyncProgress onComplete={handleSyncComplete} />}

      <div className="collection-cards">
        {collections.map((col) => {
          const status = statuses[col.name];
          return (
            <div
              key={col.name}
              className="collection-card collection-card-clickable"
              onClick={() => onSelect(col.name)}
            >
              <div className="collection-card-header">
                <span className="collection-card-type">
                  <CrawlerIcon type={col.crawlerType} />
                  {CRAWLER_LABELS[col.crawlerType] ?? col.crawlerType}
                </span>
                <div className="collection-card-badges">
                  {col.publish && <span className="status-badge status-completed">Published</span>}
                  {!col.enabled && <span className="status-badge status-failed">Disabled</span>}
                </div>
              </div>
              <h3 className="collection-card-name">{col.title || col.name}</h3>
              {col.description && (
                <p className="collection-card-desc">{col.description}</p>
              )}
              <div className="collection-card-stats">
                <span>{status?.entityCount != null ? formatCount(status.entityCount) : "—"} entities</span>
                {status?.diskSizeBytes != null && status.diskSizeBytes > 0 && (
                  <span>{formatSize(status.diskSizeBytes)}</span>
                )}
                {status?.lastSyncRun && (
                  <span>
                    Last sync: {formatTimestamp(status.lastSyncRun.startedAt)}
                    {" "}
                    <span className={`sync-type-badge sync-type-${status.lastSyncRun.syncType || "incremental"}`}>
                      {status.lastSyncRun.syncType === "full" ? "full" : "incr"}
                    </span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {collections.length === 0 && (
          <div className="empty-state-manage">
            <p>No collections yet. Add your first collection to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
