import { useState, useEffect, useRef } from "react";
import { formatTimestamp, type Collection, type PublishProgress } from "../../types";

export default function PublishPanel() {
  const [collections, setCollections] = useState<Collection[]>([]);

  // Form state — only applies to the "Publish a Collection" form at the bottom
  const [selectedCollection, setSelectedCollection] = useState("");
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);

  // Auth
  const [authChecked, setAuthChecked] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Publish progress
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/collections").then((r) => r.json()).then(setCollections).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const publishedCollections = collections.filter((c) => c.publish);

  const checkAuth = () => {
    setAuthError(null);
    fetch("/api/cloudflare/check-auth", { method: "POST" })
      .then((r) => r.json())
      .then((data: { authenticated: boolean; error?: string }) => {
        setAuthChecked(data.authenticated);
        if (!data.authenticated && data.error) setAuthError(data.error);
      })
      .catch(() => setAuthChecked(false));
  };

  const doPublish = (
    collectionName: string,
    opts: { password?: string; removePassword?: boolean },
  ) => {
    const col = collections.find((c) => c.name === collectionName);
    const isInitialPublish = !col?.publish;
    const isPublicInitialPublish = isInitialPublish && !opts.password && !opts.removePassword;
    let forcePublic = false;

    if (isPublicInitialPublish) {
      const confirmed = window.confirm(
        "No password is configured for this initial publish. Collection data will be publicly accessible. Continue?",
      );
      if (!confirmed) return;
      forcePublic = true;
    }

    setPublishing(true);
    setProgress(null);
    setError(null);

    fetch(`/api/collections/${encodeURIComponent(collectionName)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: opts.password || undefined,
        removePassword: opts.removePassword || undefined,
        forcePublic: forcePublic || undefined,
      }),
    }).catch(() => {});

    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch("/api/publish/status");
        const data: PublishProgress = await res.json();
        setProgress(data);
        if (!data.active) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPublishing(false);
          fetch("/api/collections").then((r) => r.json()).then(setCollections).catch(() => {});
        }
      } catch {}
    }, 1000);
  };

  const handleFormPublish = () => {
    if (!selectedCollection) return;
    doPublish(selectedCollection, { password, removePassword });
    setPassword("");
    setRemovePassword(false);
  };

  const handleRepublish = (collectionName: string) => {
    doPublish(collectionName, {});
  };

  const handleUnpublish = async (collectionName: string) => {
    const confirmed = window.confirm(
      `Unpublish "${collectionName}"? This will delete its Cloudflare worker, D1 database, and R2 bucket.`,
    );
    if (!confirmed) return;

    setError(null);
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(collectionName)}/publish`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unpublish failed" }));
        setError(data.error || "Unpublish failed");
      } else {
        fetch("/api/collections").then((r) => r.json()).then(setCollections).catch(() => {});
      }
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="manage-panel">
      <div className="manage-panel-header">
        <h2>Publish to Cloudflare</h2>
        <div className="sync-actions">
          <button className="btn btn-sm" onClick={checkAuth}>
            Check Connection
          </button>
          {authChecked === true && <span className="status-badge status-completed">Authenticated</span>}
          {authChecked === false && <span className="status-badge status-failed">Not authenticated</span>}
        </div>
      </div>

      {authError && <div className="form-error" style={{ whiteSpace: "pre-wrap" }}>{authError}</div>}
      {error && <div className="form-error">{error}</div>}

      {progress && (publishing || progress.error) && (
        <div className="sync-progress">
          <div className="sync-progress-header">
            <span className={`status-badge status-${progress.active ? "running" : progress.error ? "failed" : "completed"}`}>
              {progress.active ? "Publishing" : progress.error ? "Failed" : "Done"}
            </span>
          </div>
          <div className="sync-progress-status">{progress.detail || progress.step}</div>
          {progress.error && <div className="form-error">{progress.error}</div>}
        </div>
      )}

      {publishedCollections.length > 0 && (
        <div className="preset-list">
          <h3>Published Collections</h3>
          {publishedCollections.map((col) => (
            <div key={col.name} className="preset-card">
              <div className="preset-card-header">
                <div className="preset-card-title">
                  <strong>{col.title || col.name}</strong>
                  {col.publish && (
                    <a
                      href={col.publish.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="preset-link"
                      title="Open published site"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </a>
                  )}
                </div>
                <div className="preset-card-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleRepublish(col.name)}
                    disabled={publishing}
                  >
                    {publishing ? "Publishing..." : "Republish"}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleUnpublish(col.name)}
                    disabled={publishing}
                  >
                    Unpublish
                  </button>
                </div>
              </div>
              <div className="preset-card-details">
                {col.publish && (
                  <>
                    <span className="preset-deployment-info">
                      Published {formatTimestamp(col.publish.publishedAt)}
                      {" \u00b7 "}
                      <a href={col.publish.url} target="_blank" rel="noopener noreferrer" className="preset-url">{col.publish.url.replace("https://", "")}</a>
                    </span>
                    <span className="text-muted">
                      Password: {col.publish.password?.protected ? "protected" : "public"}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <h3>Publish a Collection</h3>
        <div className="form-group">
          <label>Collection</label>
          <select
            className="form-input"
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
          >
            <option value="">Select a collection...</option>
            {collections.filter((c) => c.enabled).map((col) => (
              <option key={col.name} value={col.name}>
                {col.title || col.name} {col.publish ? "(published)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Password (optional)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (e.target.value) setRemovePassword(false);
            }}
            placeholder="Leave blank to preserve current password setting"
            className="form-input"
            disabled={removePassword}
          />
          <label className="checkbox-label" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={removePassword}
              onChange={(e) => setRemovePassword(e.target.checked)}
            />
            Remove password protection on next publish
          </label>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleFormPublish}
          disabled={publishing || !selectedCollection}
        >
          {publishing ? "Publishing..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
