import { useState, useEffect, useRef } from "react";
import type { Collection, ExportProgress } from "../../types";

export default function ExportPanel() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [format, setFormat] = useState<"markdown" | "html">("markdown");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/collections").then((r) => r.json()).then(setCollections).catch(() => {});
  }, []);

  const toggleCollection = (name: string) => {
    setSelectedCollections((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const handleExport = async () => {
    setExporting(true);
    setProgress(null);

    await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collections: selectedCollections,
        outputDir,
        format,
      }),
    });

    intervalRef.current = window.setInterval(async () => {
      const res = await fetch("/api/export/status");
      const data: ExportProgress = await res.json();
      setProgress(data);
      if (!data.active) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setExporting(false);
      }
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="manage-panel">
      <div className="manage-panel-header">
        <h2>Export</h2>
      </div>

      <div className="form-group">
        <h3>Collections</h3>
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
        <h3>Format</h3>
        <div className="format-picker">
          <button
            className={`format-btn${format === "markdown" ? " active" : ""}`}
            onClick={() => setFormat("markdown")}
          >
            Export Markdown
          </button>
          <button
            className={`format-btn${format === "html" ? " active" : ""}`}
            onClick={() => setFormat("html")}
          >
            Export HTML
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>Output Directory</label>
        <input
          type="text"
          value={outputDir}
          onChange={(e) => setOutputDir(e.target.value)}
          placeholder="/path/to/output"
          className="form-input"
        />
      </div>

      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={handleExport}
          disabled={exporting || selectedCollections.length === 0 || !outputDir}
        >
          {exporting ? "Exporting..." : "Export"}
        </button>
      </div>

      {progress && (
        <div className="sync-progress">
          <div className="sync-progress-header">
            <span className={`status-badge status-${progress.active ? "running" : progress.error ? "failed" : "completed"}`}>
              {progress.active ? "Exporting" : progress.error ? "Failed" : "Done"}
            </span>
          </div>
          {progress.total > 0 && (
            <div className="sync-progress-status">
              {progress.step}: {progress.current}/{progress.total}
            </div>
          )}
          {progress.error && <div className="form-error">{progress.error}</div>}
        </div>
      )}
    </div>
  );
}
