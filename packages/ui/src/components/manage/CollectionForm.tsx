import { useState, useEffect, useRef } from "react";

declare global {
  interface Window {
    frozenink?: {
      openDirectoryPicker: () => Promise<string | null>;
      platform?: string;
    };
  }
}

interface NamedCredential {
  name: string;
  keys: string[];
}

interface CollectionFormProps {
  /** If provided, editing existing collection; else creating new */
  editName?: string;
  onSave: () => void;
  onCancel: () => void;
}

const CRAWLER_TYPES = [
  { id: "github", label: "GitHub", description: "Issues, PRs, and discussions from a GitHub repository" },
  { id: "obsidian", label: "Obsidian", description: "Notes from an Obsidian vault" },
  { id: "git", label: "Git", description: "Commits, branches, and tags from a local repository" },
  { id: "mantishub", label: "MantisHub", description: "Issues from a MantisHub instance" },
  { id: "rss", label: "RSS/Atom", description: "Posts from RSS or Atom feeds with optional sitemap backfill" },
  { id: "evernote", label: "Evernote", description: "Notes from a local Evernote v10 install (macOS)" },
];

const NO_CREDENTIALS_CRAWLERS = ["obsidian", "git", "remote", "rss", "evernote"];

function configToStrings(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return result;
}

export default function CollectionForm({ editName, onSave, onCancel }: CollectionFormProps) {
  const [loading, setLoading] = useState(!!editName);
  const [step, setStep] = useState(editName ? 2 : 1);
  const [crawler, setCrawler] = useState("");
  const [name, setName] = useState(editName ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [credMode, setCredMode] = useState<"inline" | "named">("inline");
  const [selectedCredName, setSelectedCredName] = useState<string>("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [namedCredentials, setNamedCredentials] = useState<NamedCredential[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);

  // Track original values for unsaved-change detection
  const originalRef = useRef<{
    title: string; description: string; config: string; credMode: string; selectedCredName: string; credentials: string; enabled: boolean;
  } | null>(null);

  // Fetch named credentials
  useEffect(() => {
    fetch("/api/credentials")
      .then((res) => res.json())
      .then((data: NamedCredential[]) => setNamedCredentials(data))
      .catch(() => {});
  }, []);

  // Fetch full config when editing
  useEffect(() => {
    if (!editName) return;
    fetch(`/api/collections/${encodeURIComponent(editName)}/config`)
      .then((r) => r.json())
      .then((data: { title: string; description?: string; crawler: string; enabled: boolean; config: Record<string, unknown>; credentials: string | Record<string, unknown> }) => {
        setCrawler(data.crawler);
        setTitle(data.title ?? "");
        setDescription(data.description ?? "");
        setEnabled(data.enabled);
        const cfg = configToStrings(data.config ?? {});
        setConfig(cfg);

        const isNamed = typeof data.credentials === "string";
        if (isNamed) {
          setCredMode("named");
          setSelectedCredName(data.credentials as string);
        } else {
          setCredMode("inline");
          setCredentials(configToStrings((data.credentials as Record<string, unknown>) ?? {}));
        }

        originalRef.current = {
          title: data.title ?? "",
          description: data.description ?? "",
          config: JSON.stringify(cfg),
          credMode: isNamed ? "named" : "inline",
          selectedCredName: isNamed ? (data.credentials as string) : "",
          credentials: isNamed ? "{}" : JSON.stringify(configToStrings((data.credentials as Record<string, unknown>) ?? {})),
          enabled: data.enabled,
        };

        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [editName]);

  function hasUnsavedChanges(): boolean {
    if (!editName || !originalRef.current) return false;
    const o = originalRef.current;
    return (
      title !== o.title ||
      description !== o.description ||
      enabled !== o.enabled ||
      JSON.stringify(config) !== o.config ||
      credMode !== o.credMode ||
      selectedCredName !== o.selectedCredName ||
      JSON.stringify(credentials) !== o.credentials
    );
  }

  function handleCancel() {
    if (hasUnsavedChanges()) {
      setDiscardPrompt(true);
    } else {
      onCancel();
    }
  }

  const handleCancelRef = useRef(handleCancel);
  handleCancelRef.current = handleCancel;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancelRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    const parsedConfig: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      try { parsedConfig[k] = JSON.parse(v); } catch { parsedConfig[k] = v; }
    }
    let credsPayload: string | Record<string, unknown>;
    if (credMode === "named" && selectedCredName) {
      credsPayload = selectedCredName;
    } else {
      const parsedCreds: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(credentials)) {
        try { parsedCreds[k] = JSON.parse(v); } catch { parsedCreds[k] = v; }
      }
      credsPayload = parsedCreds;
    }

    try {
      if (editName) {
        await fetch(`/api/collections/${encodeURIComponent(editName)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description: description || undefined, enabled, config: parsedConfig, credentials: credsPayload }),
        });
      } else {
        const res = await fetch("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            title: title || name,
            description: description || undefined,
            crawler,
            config: parsedConfig,
            credentials: credsPayload,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create collection");
        }
      }
      onSave();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  if (discardPrompt) {
    return (
      <div className="manage-panel">
        <div className="manage-panel-header">
          <h2>Discard changes?</h2>
        </div>
        <p className="manage-panel-subtitle">You have unsaved changes. Do you want to save or discard them?</p>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={() => setDiscardPrompt(false)}>Keep editing</button>
          <button className="btn btn-secondary" onClick={onCancel}>Discard</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="manage-panel">
        <div className="manage-panel-header">
          <h2>Add Collection</h2>
          <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
        </div>
        <p className="manage-panel-subtitle">Choose a data source</p>
        <div className="crawler-picker">
          {CRAWLER_TYPES.map((ct) => (
            <button
              key={ct.id}
              className="crawler-card"
              onClick={() => { setCrawler(ct.id); setStep(2); }}
            >
              <strong>{ct.label}</strong>
              <span>{ct.description}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="manage-panel">
      <div className="manage-panel-header">
        <h2>{editName ? `Edit: ${editName}` : `New ${CRAWLER_TYPES.find((c) => c.id === crawler)?.label} Collection`}</h2>
        <button className="btn btn-sm" onClick={handleCancel}>Cancel</button>
      </div>

      <div className="form-group">
        {!editName && (
          <>
            <label>Collection Key</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
              placeholder="my-collection"
              className="form-input"
            />
          </>
        )}
        <label>Display Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My Collection"
          className="form-input"
        />
        <label>
          Description
          <span className="form-label-hint"> — helps AI know when to search this collection</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. GitHub issues and PRs for the acme/backend repo. Search here for bug reports, feature requests, and code review history."
          className="form-input form-textarea"
          rows={3}
        />
        {editName && (
          <label className="toggle-label" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="toggle-text">Enabled</span>
          </label>
        )}
      </div>

      <div className="form-group">
        <h3>Configuration</h3>
        {renderConfigFields(crawler, config, setConfig)}
      </div>

      {!NO_CREDENTIALS_CRAWLERS.includes(crawler) && (
        <div className="form-group">
          <h3>Credentials</h3>
          {namedCredentials.length > 0 && (
            <div className="cred-mode-toggle">
              <label>
                <input
                  type="radio"
                  name="credMode"
                  value="inline"
                  checked={credMode === "inline"}
                  onChange={() => setCredMode("inline")}
                />
                Enter directly
              </label>
              <label>
                <input
                  type="radio"
                  name="credMode"
                  value="named"
                  checked={credMode === "named"}
                  onChange={() => setCredMode("named")}
                />
                Use saved credentials
                {credMode === "named" && (
                  <select
                    className="form-input"
                    value={selectedCredName}
                    onChange={(e) => setSelectedCredName(e.target.value)}
                    style={{ marginLeft: 8, minWidth: 160 }}
                  >
                    <option value="">Select...</option>
                    {namedCredentials.map((nc) => (
                      <option key={nc.name} value={nc.name}>
                        {nc.name} ({nc.keys.join(", ")})
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </div>
          )}
          {credMode === "inline" && renderCredentialFields(crawler, credentials, setCredentials)}
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      <div className="form-actions">
        <button className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={saving || (!editName && !name) || (credMode === "named" && !selectedCredName)}
        >
          {saving ? "Saving..." : editName ? "Update" : "Create"}
        </button>
      </div>
    </div>
  );
}

function PathField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const handleBrowse = async () => {
    const path = await window.frozenink?.openDirectoryPicker();
    if (path) onChange(path);
  };

  return (
    <div>
      <label>{label}</label>
      <div className="path-field">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="form-input"
        />
        {window.frozenink?.openDirectoryPicker && (
          <button type="button" className="btn btn-sm" onClick={handleBrowse} title="Browse...">
            ...
          </button>
        )}
      </div>
    </div>
  );
}

function renderConfigFields(
  crawler: string,
  config: Record<string, string>,
  setConfig: (c: Record<string, string>) => void,
) {
  const set = (key: string, val: string) => setConfig({ ...config, [key]: val });
  const field = (key: string, label: string, placeholder: string, hint?: string, type = "text") => (
    <div key={key}>
      <label>
        {label}
        {hint && <span className="form-label-hint"> — {hint}</span>}
      </label>
      <input
        type={type}
        value={config[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className="form-input"
      />
    </div>
  );

  switch (crawler) {
    case "github":
      return (
        <>
          {field("owner", "Owner", "octocat")}
          {field("repo", "Repository", "hello-world")}
          {field("maxIssues", "Max Issues", "1000", undefined, "number")}
          {field("maxPullRequests", "Max Pull Requests", "1000", undefined, "number")}
          <div>
            <label>
              <input
                type="checkbox"
                checked={config.openOnly === "true"}
                onChange={(e) => set("openOnly", String(e.target.checked))}
              />
              {" "}Open issues/PRs only
            </label>
          </div>
        </>
      );
    case "obsidian":
      return (
        <PathField
          label="Vault Path"
          value={config.vaultPath ?? ""}
          onChange={(v) => set("vaultPath", v)}
          placeholder="/path/to/vault"
        />
      );
    case "git":
      return (
        <PathField
          label="Repository Path"
          value={config.repoPath ?? ""}
          onChange={(v) => set("repoPath", v)}
          placeholder="/path/to/repo"
        />
      );
    case "mantishub":
      return (
        <>
          {field("url", "URL", "https://mantis.example.com")}
          {field("project", "Project", "mantisbt, plugins", "optional — comma-separated project names")}
        </>
      );
    case "rss":
      return (
        <>
          {field("feedUrl", "Feed URL", "https://example.com/feed.xml")}
          {field("siteUrl", "Site URL", "https://example.com", "optional — used for sitemap discovery")}
          {field("maxItems", "Max Items", "1000", "optional", "number")}
          <div>
            <label>
              <input
                type="checkbox"
                checked={config.sitemapBackfill !== "false"}
                onChange={(e) => set("sitemapBackfill", String(e.target.checked))}
              />
              {" "}Sitemap backfill on first sync
            </label>
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={config.fetchArticleContent !== "false"}
                onChange={(e) => set("fetchArticleContent", String(e.target.checked))}
              />
              {" "}Fetch article HTML fallback
            </label>
          </div>
        </>
      );
    case "remote":
      return field("sourceUrl", "Source URL", "https://example.workers.dev");
    case "evernote":
      return <EvernoteConfigFields config={config} setConfig={setConfig} />;
    default:
      return <p className="text-muted">No configuration needed.</p>;
  }
}

function renderCredentialFields(
  crawler: string,
  creds: Record<string, string>,
  setCreds: (c: Record<string, string>) => void,
) {
  const set = (key: string, val: string) => setCreds({ ...creds, [key]: val });
  const field = (key: string, label: string, placeholder: string) => (
    <div key={key}>
      <label>{label}</label>
      <input
        type="password"
        value={creds[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className="form-input"
      />
    </div>
  );

  switch (crawler) {
    case "github":
      return field("token", "GitHub Token", "ghp_...");
    case "mantishub":
      return field("token", "API Token", "your-api-token");
    case "obsidian":
    case "git":
    case "evernote":
      return <p className="text-muted">No credentials needed for local sources.</p>;
    case "remote":
      return <p className="text-muted">Credentials are inherited from the source.</p>;
    default:
      return null;
  }
}

interface EvernoteNotebookSummary {
  guid: string;
  name: string;
  noteCount: number;
  totalBytes: number;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function EvernoteConfigFields({
  config,
  setConfig,
}: {
  config: Record<string, string>;
  setConfig: (c: Record<string, string>) => void;
}) {
  const set = (key: string, val: string) => setConfig({ ...config, [key]: val });

  // Selection mode: "all" syncs every notebook; "subset" enables the multi-select.
  // We persist the comma-separated selection in the same `notebooks` config key
  // the CLI uses, so loaded collections round-trip cleanly.
  // The serialized form supports both a JSON array (preferred — round-trips
  // cleanly through configToStrings + JSON.parse on submit) and the legacy
  // comma-separated form the CLI accepts.
  const initialList = (() => {
    const raw = config.notebooks ?? "";
    if (!raw) return [] as string[];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // fall through to comma split
    }
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  })();
  const [mode, setMode] = useState<"all" | "subset">(initialList.length > 0 ? "subset" : "all");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialList));
  const [notebooks, setNotebooks] = useState<EvernoteNotebookSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotebooks = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (config.conduitStoragePath) params.set("path", config.conduitStoragePath);
      const res = await fetch(`/api/crawlers/evernote/notebooks?${params.toString()}`);
      const body = await res.json();
      if (body.error) {
        setError(body.error);
        setNotebooks([]);
      } else {
        setNotebooks(body.notebooks as EvernoteNotebookSummary[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Auto-load on first mount when no path is set (covers the auto-detect case).
  useEffect(() => {
    if (!config.conduitStoragePath) fetchNotebooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      // Store as a JSON array so handleSubmit's JSON.parse turns it into
      // a real string[] for the crawler config.
      set("notebooks", next.size > 0 ? JSON.stringify([...next]) : "");
      return next;
    });
  };

  return (
    <>
      <PathField
        label="Conduit Storage Path"
        value={config.conduitStoragePath ?? ""}
        onChange={(v) => set("conduitStoragePath", v)}
        placeholder="leave blank to auto-detect ~/Library/Containers/com.evernote.Evernote/..."
      />
      <div>
        <label>Notebooks</label>
        <div>
          <label>
            <input
              type="radio"
              checked={mode === "all"}
              onChange={() => {
                setMode("all");
                set("notebooks", "");
                setSelected(new Set());
              }}
            />
            {" "}All notebooks
          </label>
          <label style={{ marginLeft: "1em" }}>
            <input
              type="radio"
              checked={mode === "subset"}
              onChange={() => setMode("subset")}
            />
            {" "}Pick notebooks
          </label>
          <button
            type="button"
            className="btn btn-sm"
            onClick={fetchNotebooks}
            style={{ marginLeft: "1em" }}
          >
            {loading ? "Loading..." : "Refresh list"}
          </button>
        </div>
        {error && <p className="text-muted">{error}</p>}
        {mode === "subset" && notebooks && notebooks.length > 0 && (
          <div className="evernote-notebook-list" style={{ maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
            {notebooks.map((nb) => (
              <div key={nb.guid}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(nb.name)}
                    onChange={() => toggle(nb.name)}
                  />
                  {" "}{nb.name}
                  <span className="form-label-hint">
                    {" "}— {nb.noteCount} note{nb.noteCount === 1 ? "" : "s"}
                    {nb.totalBytes > 0 ? `, ${formatBytes(nb.totalBytes)}` : ""}
                  </span>
                </label>
              </div>
            ))}
          </div>
        )}
        {mode === "subset" && notebooks && notebooks.length === 0 && !loading && (
          <p className="text-muted">No notebooks found at that path.</p>
        )}
      </div>
      <div>
        <label>
          <input
            type="checkbox"
            checked={config.snapshot !== "false"}
            onChange={(e) => set("snapshot", String(e.target.checked))}
          />
          {" "}Snapshot DB before reading (only used when Evernote has uncheckpointed writes)
        </label>
      </div>
    </>
  );
}
