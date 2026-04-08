import { useState, useEffect, useRef } from "react";
import type { SyncProgress as SyncProgressType } from "../../types";

interface SyncProgressProps {
  onComplete: () => void;
}

export default function SyncProgress({ onComplete }: SyncProgressProps) {
  const [progress, setProgress] = useState<SyncProgressType | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const poll = () => {
      fetch("/api/sync/status")
        .then((r) => r.json())
        .then((data: SyncProgressType) => {
          setProgress(data);
          if (!data.active) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            onComplete();
          }
        })
        .catch(() => {});
    };

    poll();
    intervalRef.current = window.setInterval(poll, 500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [onComplete]);

  if (!progress) return null;

  return (
    <div className="sync-progress">
      <div className="sync-progress-header">
        <span className={`status-badge status-${progress.active ? "running" : progress.error ? "failed" : "completed"}`}>
          {progress.active ? "Syncing" : progress.error ? "Failed" : "Done"}
        </span>
        {progress.collectionName && (
          <span className="sync-progress-collection">{progress.collectionName}</span>
        )}
      </div>
      <div className="sync-progress-counters">
        <span className="counter counter-created">{progress.created} created</span>
        <span className="counter counter-updated">{progress.updated} updated</span>
        <span className="counter counter-deleted">{progress.deleted} deleted</span>
      </div>
      {progress.status && progress.status !== "idle" && (
        <div className="sync-progress-status">{progress.status}</div>
      )}
      {progress.error && (
        <div className="form-error">{progress.error}</div>
      )}
    </div>
  );
}
