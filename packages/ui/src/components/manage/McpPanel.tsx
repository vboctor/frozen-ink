import { useEffect, useState, useCallback } from "react";
import type { Collection, McpLinkStatus, McpTransport } from "../../types";

export default function McpPanel() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [statuses, setStatuses] = useState<McpLinkStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [colRes, mcpRes] = await Promise.all([
        fetch("/api/collections"),
        fetch("/api/mcp/status"),
      ]);
      const cols = colRes.ok ? ((await colRes.json()) as Collection[]) : [];
      const mcp = mcpRes.ok ? ((await mcpRes.json()) as McpLinkStatus[]) : [];
      setCollections(cols);
      setStatuses(mcp);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = async (tool: string, collection: string) => {
    const key = `${tool}:${collection}`;
    setBusyKey(key);
    setError(null);
    try {
      const body = {
        tool,
        collections: [collection],
        transport,
        password: transport === "http" ? passwords[collection] || undefined : undefined,
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
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemove = async (tool: string, collection: string) => {
    const key = `${tool}:${collection}`;
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch("/api/mcp/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, collections: [collection] }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unlink failed" }))) as { error?: string };
        throw new Error(data.error || "Unlink failed");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="manage-panel">
      <div className="manage-panel-header">
        <h2>MCP Integrations</h2>
        <div className="sync-actions">
          <label className="checkbox-label">
            <input
              type="radio"
              name="mcp-transport"
              checked={transport === "stdio"}
              onChange={() => setTransport("stdio")}
            />
            Local (stdio)
          </label>
          <label className="checkbox-label">
            <input
              type="radio"
              name="mcp-transport"
              checked={transport === "http"}
              onChange={() => setTransport("http")}
            />
            Remote (http)
          </label>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <div>Loading MCP status...</div>}

      {!loading && statuses.map((status) => (
        <div key={status.tool} className="preset-card" style={{ marginBottom: 16 }}>
          <div className="preset-card-header">
            <div className="preset-card-title">
              <strong>{status.displayName}</strong>
              <span className="text-muted"> ({status.tool})</span>
            </div>
            <div className="preset-card-actions">
              {!status.available && <span className="status-badge status-failed">{status.reason || "unavailable"}</span>}
              {status.available && transport === "http" && !status.supportsHttp && (
                <span className="status-badge status-failed">HTTP not supported</span>
              )}
              {status.available && transport === "stdio" && !status.supportsStdio && (
                <span className="status-badge status-failed">stdio not supported</span>
              )}
            </div>
          </div>
          <div className="preset-card-details" style={{ flexDirection: "column", gap: 8, display: "flex" }}>
            {collections.map((col) => {
              const link = status.links.find((l) => l.collection === col.name);
              const linked = !!link?.linked;
              const key = `${status.tool}:${col.name}`;
              const busy = busyKey === key;
              const transportSupported =
                transport === "http" ? status.supportsHttp : status.supportsStdio;
              const canAct = status.available && transportSupported;
              const needsPublish = transport === "http" && !col.publish;
              return (
                <div
                  key={col.name}
                  style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
                >
                  <span style={{ minWidth: 160 }}>{col.title || col.name}</span>
                  {transport === "http" && canAct && !needsPublish && (
                    <input
                      type="password"
                      placeholder="Password (blank = use stored)"
                      className="form-input"
                      style={{ maxWidth: 240 }}
                      value={passwords[col.name] ?? ""}
                      onChange={(e) =>
                        setPasswords((prev) => ({ ...prev, [col.name]: e.target.value }))
                      }
                      disabled={busy || linked}
                    />
                  )}
                  {needsPublish && (
                    <span className="text-muted">not published — publish to enable HTTP</span>
                  )}
                  {linked ? (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleRemove(status.tool, col.name)}
                      disabled={busy}
                    >
                      {busy ? "Unlinking..." : "Unlink"}
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleAdd(status.tool, col.name)}
                      disabled={busy || !canAct || needsPublish}
                    >
                      {busy ? "Linking..." : "Link"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
