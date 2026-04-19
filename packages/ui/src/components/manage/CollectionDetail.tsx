import { useState, useEffect, useRef, useCallback } from "react";
import SyncProgress, { type SyncResult } from "./SyncProgress";
import {
  formatTimestamp,
  type Collection,
  type CollectionStatus,
  type SyncRun,
  type PublishProgress,
  type McpLinkStatus,
} from "../../types";

interface CollectionDetailProps {
  name: string;
  onBack: () => void;
  onEdit: (name: string) => void;
  onCollectionsChanged?: () => void;
}

const CRAWLER_LABELS: Record<string, string> = {
  github: "GitHub",
  obsidian: "Obsidian",
  git: "Git",
  mantishub: "MantisHub",
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
    default:
      return null;
  }
}

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

export default function CollectionDetail({ name, onBack, onEdit, onCollectionsChanged }: CollectionDetailProps) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncRun[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Publish state
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState<PublishProgress | null>(null);
  const [publishPassword, setPublishPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const publishPollRef = useRef<number | null>(null);

  // MCP state
  const [mcpStatuses, setMcpStatuses] = useState<McpLinkStatus[]>([]);
  const [mcpBusyKey, setMcpBusyKey] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  const loadCollection = useCallback(() => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then((data: Collection[]) => {
        const col = data.find((c) => c.name === name);
        if (col) setCollection(col);
      })
      .catch(console.error);
  }, [name]);

  const loadStatus = useCallback(() => {
    fetch(`/api/collections/${encodeURIComponent(name)}/status`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, [name]);

  const loadHistory = useCallback(() => {
    fetch(`/api/collections/${encodeURIComponent(name)}/sync-runs`)
      .then((r) => r.json())
      .then(setSyncHistory)
      .catch(() => {});
  }, [name]);

  const loadMcp = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/status");
      if (res.ok) setMcpStatuses(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    loadCollection();
    loadStatus();
    loadHistory();
    loadMcp();
  }, [loadCollection, loadStatus, loadHistory, loadMcp]);

  useEffect(() => {
    return () => {
      if (publishPollRef.current) clearInterval(publishPollRef.current);
    };
  }, []);

  // --- Sync ---
  const handleSync = (full: boolean) => {
    setSyncing(true);
    setLastSyncResult(null);
    fetch(`/api/sync/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full }),
    }).catch(console.error);
  };

  const handleSyncComplete = useCallback((result: SyncResult) => {
    setSyncing(false);
    setLastSyncResult(result);
    loadStatus();
    loadHistory();
    onCollectionsChanged?.();
  }, [loadStatus, loadHistory, onCollectionsChanged]);

  // --- Enable/Disable ---
  const handleToggle = (enabled: boolean) => {
    fetch(`/api/collections/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).then(() => { loadCollection(); onCollectionsChanged?.(); });
  };

  // --- Delete ---
  const handleDelete = () => {
    if (deleting) {
      fetch(`/api/collections/${encodeURIComponent(name)}`, { method: "DELETE" })
        .then(() => { onCollectionsChanged?.(); onBack(); })
        .finally(() => setDeleting(false));
    } else {
      setDeleting(true);
    }
  };

  // --- Publish ---
  const doPublish = () => {
    const isInitial = !collection?.publish;
    if (isInitial && !publishPassword && !removePassword) {
      const confirmed = window.confirm(
        "No password is configured for this initial publish. Collection data will be publicly accessible. Continue?",
      );
      if (!confirmed) return;
    }

    setPublishing(true);
    setPublishProgress(null);
    setPublishError(null);

    fetch(`/api/collections/${encodeURIComponent(name)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: publishPassword || undefined,
        removePassword: removePassword || undefined,
        forcePublic: isInitial && !publishPassword && !removePassword ? true : undefined,
      }),
    }).catch(() => {});

    publishPollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch("/api/publish/status");
        const data: PublishProgress = await res.json();
        setPublishProgress(data);
        if (!data.active) {
          if (publishPollRef.current) clearInterval(publishPollRef.current);
          setPublishing(false);
          if (data.error) setPublishError(data.error);
          loadCollection();
        }
      } catch {}
    }, 1000);

    setPublishPassword("");
    setRemovePassword(false);
  };

  const handleUnpublish = async () => {
    const confirmed = window.confirm(
      `Unpublish "${name}"? This will delete its Cloudflare worker, D1 database, and R2 bucket.`,
    );
    if (!confirmed) return;

    setPublishError(null);
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(name)}/unpublish`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unpublish failed" }));
        setPublishError(data.error || "Unpublish failed");
      } else {
        loadCollection();
      }
    } catch (err) {
      setPublishError(String(err));
    }
  };

  // --- MCP ---
  const handleMcpLink = async (tool: string, transport: "stdio" | "http") => {
    const key = `${tool}:${transport}`;
    setMcpBusyKey(key);
    setMcpError(null);
    try {
      const body = {
        tool,
        collections: [name],
        transport,
      };
      const res = await fetch("/api/mcp/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Link failed" }))) as { error?: string };
        throw new Error(data.error || "Link failed");
      }
      await loadMcp();
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusyKey(null);
    }
  };

  const handleMcpUnlink = async (tool: string) => {
    const key = `${tool}:unlink`;
    setMcpBusyKey(key);
    setMcpError(null);
    try {
      const res = await fetch("/api/mcp/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, collections: [name] }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unlink failed" }))) as { error?: string };
        throw new Error(data.error || "Unlink failed");
      }
      await loadMcp();
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusyKey(null);
    }
  };

  if (!collection) return <div className="loading">Loading...</div>;

  // Filter MCP tools to only those relevant for this collection
  const hasCloud = !!collection.publish;

  return (
    <div className="manage-panel">
      {/* Header with back button */}
      <div className="manage-panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-sm" onClick={onBack} title="Back to collections">
            &larr; Back
          </button>
          <h2>{collection.title || collection.name}</h2>
          <span className="collection-card-type">
            <CrawlerIcon type={collection.crawlerType} />
            {CRAWLER_LABELS[collection.crawlerType] ?? collection.crawlerType}
          </span>
        </div>
        <div className="sync-actions">
          <button className="btn btn-sm" onClick={() => onEdit(name)}>Edit</button>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={collection.enabled}
              onChange={(e) => handleToggle(e.target.checked)}
            />
            <span className="toggle-text">Enabled</span>
          </label>
        </div>
      </div>

      {collection.description && (
        <p className="manage-panel-subtitle">{collection.description}</p>
      )}

      {/* --- Sync Section --- */}
      <div className="detail-section">
        <h3>Sync</h3>
        <div className="collection-card-stats">
          <span>{status?.entityCount != null ? formatCount(status.entityCount) : "—"} entities</span>
          {status?.diskSizeBytes != null && status.diskSizeBytes > 0 && (
            <span>{formatSize(status.diskSizeBytes)}</span>
          )}
          {status?.lastSyncRun && (
            <span>
              Last sync: {formatTimestamp(status.lastSyncRun.startedAt)}
              {collection?.crawlerType !== "remote" && (
                <>
                  {" "}
                  <span className={`sync-type-badge sync-type-${status.lastSyncRun.syncType || "incremental"}`}>
                    {status.lastSyncRun.syncType === "full" ? "full" : "incr"}
                  </span>
                </>
              )}
            </span>
          )}
        </div>
        <div className="collection-card-actions" style={{ marginTop: 8 }}>
          {collection?.crawlerType === "remote" ? (
            <button className="btn btn-sm" onClick={() => handleSync(false)} disabled={syncing}>
              Sync
            </button>
          ) : (
            <>
              <button className="btn btn-sm" onClick={() => handleSync(false)} disabled={syncing}>
                Sync
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => handleSync(true)} disabled={syncing}>
                Full Sync
              </button>
            </>
          )}
          {syncHistory.length > 0 && (
            <button
              className={`btn btn-sm${showHistory ? " active" : ""}`}
              onClick={() => setShowHistory(!showHistory)}
            >
              History
            </button>
          )}
        </div>
        {syncing && <SyncProgress onComplete={handleSyncComplete} />}
        {!syncing && lastSyncResult && (
          <div className="sync-result" style={{ marginTop: 8 }}>
            {lastSyncResult.error ? (
              <div className="form-error">{lastSyncResult.error}</div>
            ) : (
              <span className="collection-card-stats">
                <span>{lastSyncResult.created} created, {lastSyncResult.updated} updated, {lastSyncResult.deleted} deleted</span>
                {status?.lastSyncRun && <span>Last sync: {formatTimestamp(status.lastSyncRun.startedAt)}</span>}
              </span>
            )}
          </div>
        )}
        {showHistory && syncHistory.length > 0 && (
          <div className="collection-card-history" style={{ marginTop: 8 }}>
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
                {syncHistory.slice(0, 10).map((run) => (
                  <tr key={run.id}>
                    <td><span className={`status-badge status-${run.status}`}>{run.status}</span></td>
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

      {/* --- Publish Section --- */}
      <div className="detail-section">
        <h3>Publish</h3>
        {publishError && <div className="form-error">{publishError}</div>}

        {publishProgress && (publishing || publishProgress.error) && (
          <div className="sync-progress">
            <div className="sync-progress-header">
              <span className={`status-badge status-${publishProgress.active ? "running" : publishProgress.error ? "failed" : "completed"}`}>
                {publishProgress.active ? "Publishing" : publishProgress.error ? "Failed" : "Done"}
              </span>
            </div>
            <div className="sync-progress-status">{publishProgress.detail || publishProgress.step}</div>
          </div>
        )}

        {collection.publish ? (
          <div>
            <div className="collection-card-stats">
              <span>
                <a href={collection.publish.url} target="_blank" rel="noopener noreferrer">
                  {collection.publish.url.replace("https://", "")}
                </a>
              </span>
              {collection.publish.protected && <span>Password protected</span>}
              <span>Published {formatTimestamp(collection.publish.publishedAt)}</span>
            </div>
            <div className="collection-card-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={doPublish} disabled={publishing}>
                {publishing ? "Publishing..." : "Republish"}
              </button>
              <button className="btn btn-sm btn-danger" onClick={handleUnpublish} disabled={publishing}>
                Unpublish
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="form-group">
              <label>Password (optional)</label>
              <input
                type="password"
                value={publishPassword}
                onChange={(e) => { setPublishPassword(e.target.value); if (e.target.value) setRemovePassword(false); }}
                placeholder="Leave blank for public access"
                className="form-input"
                disabled={removePassword}
              />
            </div>
            <button className="btn btn-primary btn-sm" onClick={doPublish} disabled={publishing}>
              {publishing ? "Publishing..." : "Publish"}
            </button>
          </div>
        )}
      </div>

      {/* --- MCP Section --- */}
      <div className="detail-section">
        <h3>MCP</h3>
        {mcpError && <div className="form-error">{mcpError}</div>}
        {mcpStatuses.length > 0 ? (
          <table className="sync-history-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Local</th>
                {hasCloud && <th>Cloud</th>}
              </tr>
            </thead>
            <tbody>
              {mcpStatuses.map((s) => {
                const link = s.links.find((l) => l.collection === name);
                const linked = !!link?.linked;
                const localBusy = mcpBusyKey === `${s.tool}:stdio`;
                const cloudBusy = mcpBusyKey === `${s.tool}:http`;
                const unlinkBusy = mcpBusyKey === `${s.tool}:unlink`;

                // Local: only show if the tool is detected locally (available + supports stdio)
                const showLocal = s.available && s.supportsStdio;
                // Cloud: only if collection is published and tool supports http
                const showCloud = hasCloud && s.supportsHttp;

                // Skip tools that have neither local nor cloud available
                if (!showLocal && !showCloud) return null;

                return (
                  <tr key={s.tool}>
                    <td>
                      <strong>{s.displayName}</strong>
                    </td>
                    <td>
                      {showLocal ? (
                        linked ? (
                          <button className="btn btn-sm btn-danger" onClick={() => handleMcpUnlink(s.tool)} disabled={unlinkBusy}>
                            {unlinkBusy ? "..." : "Unlink"}
                          </button>
                        ) : (
                          <button className="btn btn-sm btn-primary" onClick={() => handleMcpLink(s.tool, "stdio")} disabled={localBusy}>
                            {localBusy ? "..." : "Link"}
                          </button>
                        )
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    {hasCloud && (
                      <td>
                        {showCloud ? (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-sm btn-primary" onClick={() => handleMcpLink(s.tool, "http")} disabled={cloudBusy}>
                              {cloudBusy ? "..." : "Link"}
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleMcpUnlink(s.tool)} disabled={unlinkBusy}>
                              {unlinkBusy ? "..." : "Unlink"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">No MCP tools available.</p>
        )}
      </div>

      {/* --- Danger Zone --- */}
      <div className="detail-section detail-section-danger">
        <h3>Danger Zone</h3>
        <button
          className={`btn btn-sm btn-danger${deleting ? " confirm" : ""}`}
          onClick={handleDelete}
        >
          {deleting ? "Click again to confirm deletion" : "Delete Collection"}
        </button>
      </div>
    </div>
  );
}
