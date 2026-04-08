import { useState, useEffect } from "react";
import type { VeeContextConfig } from "../../types";

export default function SettingsPanel() {
  const [config, setConfig] = useState<VeeContextConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sync: config.sync,
        logging: config.logging,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!config) return <div className="loading">Loading...</div>;

  return (
    <div className="manage-panel">
      <div className="manage-panel-header">
        <h2>Settings</h2>
      </div>

      <div className="form-group">
        <h3>Sync</h3>
        <label>Interval (seconds)</label>
        <input
          type="number"
          value={config.sync.interval}
          onChange={(e) =>
            setConfig({ ...config, sync: { ...config.sync, interval: Number(e.target.value) } })
          }
          className="form-input"
        />
        <label>Concurrency</label>
        <input
          type="number"
          value={config.sync.concurrency}
          onChange={(e) =>
            setConfig({ ...config, sync: { ...config.sync, concurrency: Number(e.target.value) } })
          }
          className="form-input"
        />
        <label>Retries</label>
        <input
          type="number"
          value={config.sync.retries}
          onChange={(e) =>
            setConfig({ ...config, sync: { ...config.sync, retries: Number(e.target.value) } })
          }
          className="form-input"
        />
      </div>

      <div className="form-group">
        <h3>Logging</h3>
        <label>Level</label>
        <select
          value={config.logging.level}
          onChange={(e) =>
            setConfig({ ...config, logging: { ...config.logging, level: e.target.value } })
          }
          className="form-input"
        >
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
        {saved && <span className="status-badge status-completed">Saved</span>}
      </div>
    </div>
  );
}
