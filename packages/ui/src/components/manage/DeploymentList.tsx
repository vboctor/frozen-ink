import { useState } from "react";
import { formatTimestamp, type Deployment } from "../../types";

interface DeploymentListProps {
  deployments: Deployment[];
  onRefresh: () => void;
}

export default function DeploymentList({ deployments, onRefresh }: DeploymentListProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [unpublishing, setUnpublishing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUnpublish = async (name: string) => {
    if (confirming !== name) {
      setConfirming(name);
      return;
    }

    setConfirming(null);
    setUnpublishing(name);
    setError(null);

    try {
      const res = await fetch(`/api/deployments/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unpublish failed" }));
        setError(data.error || "Unpublish failed");
      } else {
        onRefresh();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setUnpublishing(null);
    }
  };

  if (deployments.length === 0) return null;

  return (
    <div className="deployment-list">
      <h3>Deployments</h3>
      {error && <div className="form-error">{error}</div>}
      <table className="sync-history-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>URL</th>
            <th>Collections</th>
            <th>Password</th>
            <th>Published</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((dep) => (
            <tr key={dep.name}>
              <td>{dep.name}</td>
              <td>
                <a href={dep.url} target="_blank" rel="noopener noreferrer">
                  {dep.url.replace("https://", "")}
                </a>
              </td>
              <td>{dep.collections.join(", ")}</td>
              <td>{dep.passwordProtected ? "Yes" : "No"}</td>
              <td>{formatTimestamp(dep.publishedAt)}</td>
              <td>
                {unpublishing === dep.name ? (
                  <span className="text-muted">Unpublishing...</span>
                ) : (
                  <button
                    className={`btn btn-sm btn-danger${confirming === dep.name ? " confirm" : ""}`}
                    onClick={() => handleUnpublish(dep.name)}
                    onBlur={() => { if (confirming === dep.name) setConfirming(null); }}
                  >
                    {confirming === dep.name ? "Confirm Delete" : "Unpublish"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
