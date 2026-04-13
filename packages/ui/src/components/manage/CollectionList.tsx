import { useState, useEffect } from "react";
import SyncProgress from "./SyncProgress";
import { formatTimestamp, type Collection, type CollectionStatus, type SyncRun } from "../../types";

const CRAWLER_LABELS: Record<string, string> = {
  github: "GitHub",
  obsidian: "Obsidian",
  git: "Git",
  mantishub: "MantisHub",
};

interface CollectionListProps {
  onEdit: (name: string) => void;
  onAdd: () => void;
  onSyncComplete?: () => void;
  onCollectionsChanged?: () => void;
}

export default function CollectionList({ onEdit, onAdd, onSyncComplete, onCollectionsChanged }: CollectionListProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [statuses, setStatuses] = useState<Record<string, CollectionStatus>>({});
  const [syncHistory, setSyncHistory] = useState<Record<string, SyncRun[]>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  const load = () => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then((data: Collection[]) => {
        setCollections(data);
        for (const col of data) {
          loadStatus(col.name);
          loadHistory(col.name);
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

  const loadHistory = (name: string) => {
    fetch(`/api/collections/${encodeURIComponent(name)}/sync-runs`)
      .then((r) => r.json())
      .then((runs: SyncRun[]) => {
        setSyncHistory((prev) => ({ ...prev, [name]: runs }));
      })
      .catch(() => {});
  };

  useEffect(load, []);

  const handleToggle = (name: string, enabled: boolean) => {
    fetch(`/api/collections/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).then(() => { load(); onCollectionsChanged?.(); });
  };

  const handleDelete = (name: string) => {
    if (deleting === name) {
      fetch(`/api/collections/${encodeURIComponent(name)}`, { method: "DELETE" })
        .then(() => { load(); onCollectionsChanged?.(); })
        .finally(() => setDeleting(null));
    } else {
      setDeleting(name);
    }
  };

  const syncAll = (full: boolean) => {
    setSyncing(true);
    fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full }),
    }).catch(console.error);
  };

  const syncOne = (name: string, full: boolean) => {
    setSyncing(true);
    fetch(`/api/sync/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full }),
    }).catch(console.error);
  };

  const handleSyncComplete = () => {
    setSyncing(false);
    for (const col of collections) {
      loadStatus(col.name);
      loadHistory(col.name);
    }
    onSyncComplete?.();
  };

  return (
    <div className="manage-panel">
      <div className="manage-panel-header">
        <h2>Collections</h2>
        <div className="sync-actions">
          <button className="btn btn-sm" onClick={() => syncAll(false)} disabled={syncing}>
            Sync All
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => syncAll(true)} disabled={syncing}>
            Full Sync All
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
          const runs = syncHistory[col.name] ?? [];
          const isExpanded = expandedHistory === col.name;
          return (
            <div key={col.name} className="collection-card">
              <div className="collection-card-header">
                <span className="collection-card-type">
                  {CRAWLER_LABELS[col.crawlerType] ?? col.crawlerType}
                </span>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={col.enabled}
                    onChange={(e) => handleToggle(col.name, e.target.checked)}
                  />
                  <span className="toggle-text">Enabled</span>
                </label>
              </div>
              <h3 className="collection-card-name">{col.title || col.name}</h3>
              <div className="collection-card-stats">
                <span>{status?.entityCount ?? "—"} entities</span>
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
              <div className="collection-card-actions">
                <button className="btn btn-sm" onClick={() => syncOne(col.name, false)} disabled={syncing}>
                  Sync
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => syncOne(col.name, true)} disabled={syncing}>
                  Full Sync
                </button>
                <button className="btn btn-sm" onClick={() => onEdit(col.name)}>
                  Edit
                </button>
                {runs.length > 0 && (
                  <button
                    className={`btn btn-sm${isExpanded ? " active" : ""}`}
                    onClick={() => setExpandedHistory(isExpanded ? null : col.name)}
                  >
                    History
                  </button>
                )}
                <button
                  className={`btn btn-sm btn-danger${deleting === col.name ? " confirm" : ""}`}
                  onClick={() => handleDelete(col.name)}
                >
                  {deleting === col.name ? "Confirm Delete" : "Delete"}
                </button>
              </div>
              {isExpanded && runs.length > 0 && (
                <div className="collection-card-history">
                  <table className="sync-history-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Type</th>
                        <th>Created</th>
                        <th>Updated</th>
                        <th>Deleted</th>
                        <th>Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.slice(0, 10).map((run) => (
                        <tr key={run.id}>
                          <td>
                            <span className={`status-badge status-${run.status}`}>{run.status}</span>
                          </td>
                          <td>
                            <span className={`sync-type-badge sync-type-${run.syncType || "incremental"}`}>
                              {run.syncType === "full" ? "full" : "incr"}
                            </span>
                          </td>
                          <td>{run.entitiesCreated}</td>
                          <td>{run.entitiesUpdated}</td>
                          <td>{run.entitiesDeleted}</td>
                          <td>{formatTimestamp(run.startedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
