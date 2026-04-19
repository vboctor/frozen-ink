import { useState, useEffect } from "react";
import type { FrozenInkConfig } from "../../types";

export default function SettingsPanel() {
  const [config, setConfig] = useState<FrozenInkConfig | null>(null);
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
        ui: config.ui,
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
      </div>

      <div className="form-group">
        <h3>UI</h3>
        <label>Port</label>
        <input
          type="number"
          value={config.ui.port}
          onChange={(e) =>
            setConfig({ ...config, ui: { ...config.ui, port: Number(e.target.value) } })
          }
          className="form-input"
        />
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
