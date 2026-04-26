import { useEffect, useRef, useState } from "react";
import type { SyncJob } from "../../types";

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

interface ActiveSyncsProps {
  /** Called when a job transitions from active to completed so the parent can refresh stats. */
  onJobComplete?: (job: SyncJob) => void;
}

export default function ActiveSyncs({ onJobComplete }: ActiveSyncsProps) {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [now, setNow] = useState(Date.now());
  const seenActiveRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/sync/jobs");
        if (!res.ok) return;
        const data: SyncJob[] = await res.json();
        if (cancelled) return;
        // Detect completions: any job that was previously active and is no longer
        const seen = seenActiveRef.current;
        for (const job of data) {
          if (job.active) {
            seen.add(job.collectionName);
          } else if (seen.has(job.collectionName)) {
            seen.delete(job.collectionName);
            onJobComplete?.(job);
          }
        }
        setJobs(data);
      } catch {}
    };

    poll();
    const id = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [onJobComplete]);

  if (jobs.length === 0) return null;

  return (
    <div className="active-syncs">
      <div className="active-syncs-header">Active Syncs</div>
      <div className="active-syncs-list">
        {jobs.map((job) => {
          const elapsed = job.active
            ? now - job.startedAt
            : (job.completedAt ?? now) - job.startedAt;
          const state = job.active ? "running" : job.error ? "failed" : "completed";
          return (
            <div key={job.collectionName} className="active-sync-card">
              <div className="active-sync-row">
                <span className="active-sync-name" title={job.collectionName}>
                  {job.collectionName}
                </span>
                <span className={`status-badge status-${state}`}>
                  {job.active ? "Syncing" : job.error ? "Failed" : "Done"}
                </span>
              </div>
              <div className="active-sync-counters">
                <span className="counter counter-created">+{job.created}</span>
                <span className="counter counter-updated">~{job.updated}</span>
                <span className="counter counter-deleted">−{job.deleted}</span>
                <span className="active-sync-elapsed">{formatElapsed(elapsed)}</span>
              </div>
              {job.status && job.status !== "idle" && (
                <div className="active-sync-status" title={job.status}>
                  {job.status}
                </div>
              )}
              {job.error && <div className="active-sync-error">{job.error}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
