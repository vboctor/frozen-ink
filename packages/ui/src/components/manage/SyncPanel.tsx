import { useState, useEffect } from "react";
import SyncProgress from "./SyncProgress";
import { formatTimestamp, type Collection, type CollectionStatus, type SyncRun } from "../../types";

interface SyncPanelProps {
  onSyncComplete?: () => void;
}

export default function SyncPanel({ onSyncComplete }: SyncPanelProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncHistory, setSyncHistory] = useState<Record<string, SyncRun[]>>({});
  const [statuses, setStatuses] = useState<Record<string, CollectionStatus>>({});

  const loadCollections = () => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then(setCollections)
      .catch(console.error);
  };

  useEffect(loadCollections, []);

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

  useEffect(() => {
    for (const col of collections) {
      loadStatus(col.name);
      loadHistory(col.name);
    }
  }, [collections]);

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
    // Reload everything after sync
    for (const col of collections) {
      loadHistory(col.name);
      loadStatus(col.name);
    }
    onSyncComplete?.();
  };

  const enabled = collections.filter((c) => c.enabled);

  return (
    <div className="manage-panel">
      <div className="manage-panel-header">
        <h2>Sync</h2>
        <div className="sync-actions">
          <button className="btn btn-sm" onClick={() => syncAll(false)} disabled={syncing}>
            Sync All
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => syncAll(true)} disabled={syncing}>
            Full Sync All
          </button>
        </div>
      </div>

      {syncing && <SyncProgress onComplete={handleSyncComplete} />}

      <div className="sync-collections">
        {enabled.map((col) => {
          const status = statuses[col.name];
          return (
            <div key={col.name} className="sync-collection-row">
              <div className="sync-collection-info">
                <strong>{col.title || col.name}</strong>
                <span className="text-muted">{col.crawlerType}</span>
                {status && (
                  <span className="sync-entity-count">{status.entityCount} entities</span>
                )}
              </div>
              <div className="sync-collection-buttons">
                <button
                  className="btn btn-sm"
                  onClick={() => syncOne(col.name, false)}
                  disabled={syncing}
                >
                  Sync
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => syncOne(col.name, true)}
                  disabled={syncing}
                >
                  Full Sync
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {enabled.map((col) => {
        const runs = syncHistory[col.name] ?? [];
        if (runs.length === 0) return null;
        return (
          <div key={col.name} className="sync-history">
            <h3>{col.title || col.name} — History</h3>
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
        );
      })}
    </div>
  );
}
