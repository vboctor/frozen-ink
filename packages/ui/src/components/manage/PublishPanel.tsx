import { useState, useEffect, useRef } from "react";
import { formatTimestamp, type Collection, type Deployment, type PublishProgress, type PublishPreset } from "../../types";

type FormMode = "idle" | "creating" | "editing";

export default function PublishPanel() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [presets, setPresets] = useState<PublishPreset[]>([]);

  // Form state
  const [formMode, setFormMode] = useState<FormMode>("idle");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [presetName, setPresetName] = useState("");
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [workerName, setWorkerName] = useState("");
  const [password, setPassword] = useState("");

  // Auth
  const [authChecked, setAuthChecked] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Publish/unpublish progress
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState<string | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/collections").then((r) => r.json()).then(setCollections).catch(() => {});
    loadDeployments();
    loadPresets();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ESC dismisses the form
  useEffect(() => {
    if (formMode === "idle") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeForm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [formMode]);

  const loadDeployments = () => {
    fetch("/api/deployments").then((r) => r.json()).then(setDeployments).catch(() => {});
  };

  const loadPresets = () => {
    fetch("/api/publish-presets")
      .then((r) => r.json())
      .then((data: PublishPreset[]) => setPresets(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const persistPresets = (updated: PublishPreset[]) => {
    setPresets(updated);
    fetch("/api/publish-presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presets: updated }),
    }).catch(() => {});
  };

  const getDeployment = (wName: string): Deployment | undefined =>
    deployments.find((d) => d.name === wName);

  // --- Auth ---

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

  // --- Form ---

  const openCreate = () => {
    setFormMode("creating");
    setEditIdx(null);
    setPresetName("");
    setWorkerName("");
    setSelectedCollections([]);
    setPassword("");
  };

  const openEdit = (idx: number) => {
    const p = presets[idx];
    setFormMode("editing");
    setEditIdx(idx);
    setPresetName(p.name);
    setWorkerName(p.workerName);
    setSelectedCollections([...p.collections]);
    setPassword(p.password);
  };

  const closeForm = () => {
    setFormMode("idle");
    setEditIdx(null);
  };

  const toggleCollection = (name: string) => {
    setSelectedCollections((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const handleSave = () => {
    const preset: PublishPreset = {
      name: presetName || workerName || "Untitled",
      workerName,
      collections: selectedCollections,
      password,
    };
    if (formMode === "editing" && editIdx !== null) {
      const updated = [...presets];
      updated[editIdx] = preset;
      persistPresets(updated);
    } else {
      persistPresets([...presets, preset]);
    }
    closeForm();
  };

  const handleDeleteSite = async (idx: number) => {
    const preset = presets[idx];
    const dep = preset ? getDeployment(preset.workerName) : undefined;
    if (dep) {
      setUnpublishing(preset.workerName);
      setError(null);
      try {
        const res = await fetch(`/api/deployments/${encodeURIComponent(dep.name)}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Unpublish failed" }));
          setError(data.error || "Unpublish failed");
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setUnpublishing(null);
        loadDeployments();
      }
    }
    persistPresets(presets.filter((_, i) => i !== idx));
    if (editIdx === idx) closeForm();
  };

  // --- Publish ---

  const handlePublish = (preset: PublishPreset) => {
    setPublishing(true);
    setProgress(null);
    setError(null);

    fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collections: preset.collections,
        name: preset.workerName || undefined,
        password: preset.password || undefined,
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
          loadDeployments();
        }
      } catch {}
    }, 1000);
  };

  // --- Render ---

  const showingForm = formMode !== "idle";

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

      {/* Progress */}
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

      {/* Preset list */}
      {!showingForm && (
        <>
          <div className="preset-list">
            {presets.map((p, i) => {
              const dep = getDeployment(p.workerName);
              return (
                <div key={i} className="preset-card">
                  <div className="preset-card-header">
                    <div className="preset-card-title">
                      <strong>{p.name}</strong>
                      <span className="preset-worker-name">({p.workerName})</span>
                      {dep && (
                        <a
                          href={dep.url}
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
                      <button className="btn btn-sm" onClick={() => openEdit(i)} disabled={publishing}>
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handlePublish(p)}
                        disabled={publishing || p.collections.length === 0 || !p.workerName}
                      >
                        {publishing ? "Publishing..." : "Publish"}
                      </button>
                    </div>
                  </div>
                  <div className="preset-card-details">
                    <span className="text-muted">Collections: {p.collections.join(", ") || "none"}</span>
                    {dep && (
                      <span className="preset-deployment-info">
                        Published {formatTimestamp(dep.publishedAt)}
                        {" \u00b7 "}
                        <a href={dep.url} target="_blank" rel="noopener noreferrer" className="preset-url">{dep.url.replace("https://", "")}</a>
                      </span>
                    )}
                    {!dep && (
                      <span className="preset-deployment-info text-muted">Not published</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-sm" onClick={openCreate}>+ New Site</button>
          </div>
        </>
      )}

      {/* Preset form (create or edit) */}
      {showingForm && (
        <div className="preset-form">
          <h3>{formMode === "creating" ? "New Site" : `Edit: ${presets[editIdx!]?.name}`}</h3>

          <div className="form-group">
            <label>Site Name</label>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="My Publish Config"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>Worker Name</label>
            <input
              type="text"
              value={workerName}
              onChange={(e) => setWorkerName(e.target.value)}
              placeholder="fink-my-project"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <h3>Collections to Publish</h3>
            {collections.filter((c) => c.enabled).map((col) => (
              <label key={col.name} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedCollections.includes(col.name)}
                  onChange={() => toggleCollection(col.name)}
                />
                {col.title || col.name}
              </label>
            ))}
          </div>

          <div className="form-group">
            <label>Password (optional — leave blank for public access)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank for no password"
              className="form-input"
            />
          </div>

          <div className="form-actions">
            <button className="btn btn-secondary" onClick={closeForm}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!workerName}>
              {formMode === "creating" ? "Save Site" : "Update Site"}
            </button>
            {formMode === "editing" && editIdx !== null && (
              <button className="btn btn-danger-solid" style={{ marginLeft: "auto" }} onClick={() => { handleDeleteSite(editIdx); }}>
                Delete Site
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
