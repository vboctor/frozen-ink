import { useState, useEffect } from "react";

interface CollectionFormProps {
  /** If provided, editing existing collection; else creating new */
  editName?: string;
  editConfig?: {
    title: string;
    description?: string;
    crawler: string;
    config: Record<string, unknown>;
    credentials: Record<string, unknown>;
  };
  onSave: () => void;
  onCancel: () => void;
}

const CRAWLER_TYPES = [
  { id: "github", label: "GitHub", description: "Issues, PRs, and discussions from a GitHub repository" },
  { id: "obsidian", label: "Obsidian", description: "Notes from an Obsidian vault" },
  { id: "git", label: "Git", description: "Commits, branches, and tags from a local repository" },
  { id: "mantisbt", label: "MantisBT", description: "Issues from a MantisBT instance" },
];

export default function CollectionForm({ editName, editConfig, onSave, onCancel }: CollectionFormProps) {
  const [step, setStep] = useState(editConfig ? 2 : 1);
  const [crawler, setCrawler] = useState(editConfig?.crawler ?? "");
  const [name, setName] = useState(editName ?? "");
  const [title, setTitle] = useState(editConfig?.title ?? "");
  const [description, setDescription] = useState(editConfig?.description ?? "");
  const [config, setConfig] = useState<Record<string, string>>(
    configToStrings(editConfig?.config ?? {}),
  );
  const [credentials, setCredentials] = useState<Record<string, string>>(
    configToStrings(editConfig?.credentials ?? {}),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC dismisses the form
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  function configToStrings(obj: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return result;
  }

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    const parsedConfig: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      try { parsedConfig[k] = JSON.parse(v); } catch { parsedConfig[k] = v; }
    }
    const parsedCreds: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(credentials)) {
      try { parsedCreds[k] = JSON.parse(v); } catch { parsedCreds[k] = v; }
    }

    try {
      if (editName) {
        await fetch(`/api/collections/${encodeURIComponent(editName)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description: description || undefined, config: parsedConfig, credentials: parsedCreds }),
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
            credentials: parsedCreds,
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
        <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
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
      </div>

      <div className="form-group">
        <h3>Configuration</h3>
        {renderConfigFields(crawler, config, setConfig)}
      </div>

      <div className="form-group">
        <h3>Credentials</h3>
        {renderCredentialFields(crawler, credentials, setCredentials)}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="form-actions">
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={saving || (!editName && !name)}
        >
          {saving ? "Saving..." : editName ? "Update" : "Create"}
        </button>
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
  const field = (key: string, label: string, placeholder: string, type = "text") => (
    <div key={key}>
      <label>{label}</label>
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
          {field("maxIssues", "Max Issues", "1000", "number")}
          {field("maxPullRequests", "Max Pull Requests", "1000", "number")}
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
      return field("vaultPath", "Vault Path", "/path/to/vault");
    case "git":
      return field("repoPath", "Repository Path", "/path/to/repo");
    case "mantisbt":
      return (
        <>
          {field("baseUrl", "MantisBT URL", "https://mantis.example.com")}
          {field("projectName", "Project Name", "My Project")}
        </>
      );
    default:
      return <p>Unknown crawler type</p>;
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
    case "mantisbt":
      return field("token", "API Token", "your-api-token");
    case "obsidian":
    case "git":
      return <p className="text-muted">No credentials needed for local sources.</p>;
    default:
      return null;
  }
}
