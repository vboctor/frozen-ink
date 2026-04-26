import { useState, useEffect, useRef } from "react";
import type { SyncJob } from "../types";

interface BrowseSyncButtonProps {
  collectionName: string;
  onSyncComplete?: () => void;
}

export default function BrowseSyncButton({ collectionName, onSyncComplete }: BrowseSyncButtonProps) {
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncJob | null>(null);
  const intervalRef = useRef<number | null>(null);
  const hasSeenActiveRef = useRef(false);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startSync = () => {
    setOpen(true);
    setSyncing(true);
    setProgress(null);
    hasSeenActiveRef.current = false;

    fetch(`/api/sync/${encodeURIComponent(collectionName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: false }),
    }).catch(console.error);

    const poll = () => {
      fetch("/api/sync/jobs")
        .then((r) => r.json())
        .then((jobs: SyncJob[]) => {
          const job = jobs.find((j) => j.collectionName === collectionName);
          if (!job) return;
          setProgress(job);
          if (job.active) hasSeenActiveRef.current = true;
          if (!job.active && hasSeenActiveRef.current) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            setSyncing(false);
            onSyncComplete?.();
          }
        })
        .catch(() => {});
    };
    poll();
    intervalRef.current = window.setInterval(poll, 500);
  };

  const close = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setOpen(false);
    setSyncing(false);
  };

  return (
    <>
      <button
        className="nav-btn icon-btn"
        onClick={startSync}
        title="Sync collection"
        aria-label="Sync collection"
        disabled={syncing}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>

      {open && (
        <div className="search-overlay" onClick={close}>
          <div className="search-dialog sync-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sync-dialog-header">
              <h3>Sync "{collectionName}"</h3>
              <button className="nav-btn icon-btn" onClick={close} aria-label="Close">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="sync-dialog-body">
              {progress ? (
                <>
                  <div className="sync-progress-header">
                    <span className={`status-badge status-${progress.active ? "running" : progress.error ? "failed" : "completed"}`}>
                      {progress.active ? "Syncing" : progress.error ? "Failed" : "Done"}
                    </span>
                    <span className="sync-progress-collection">{progress.collectionName}</span>
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
                </>
              ) : (
                <div className="sync-progress-status">Starting...</div>
              )}
            </div>
            {!syncing && (
              <div className="sync-dialog-footer">
                <button className="btn btn-primary btn-sm" onClick={close}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
