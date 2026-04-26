import { useState, useEffect, useRef } from "react";
import type { SyncJob } from "../../types";

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  error: string | null;
}

interface SyncProgressProps {
  /** When provided, only track this collection's job. When omitted, aggregate across all jobs. */
  collectionName?: string;
  onComplete: (result: SyncResult) => void;
}

interface AggregateView {
  active: boolean;
  collectionName: string | null;
  status: string;
  created: number;
  updated: number;
  deleted: number;
  error: string | null;
}

function aggregate(jobs: SyncJob[]): AggregateView {
  if (jobs.length === 0) {
    return { active: false, collectionName: null, status: "idle", created: 0, updated: 0, deleted: 0, error: null };
  }
  const active = jobs.filter((j) => j.active);
  const totals = jobs.reduce(
    (acc, j) => ({
      created: acc.created + j.created,
      updated: acc.updated + j.updated,
      deleted: acc.deleted + j.deleted,
    }),
    { created: 0, updated: 0, deleted: 0 },
  );
  if (active.length > 0) {
    return {
      active: true,
      collectionName: active.length === 1 ? active[0].collectionName : null,
      status: active.length === 1 ? active[0].status : `syncing ${active.length} collections`,
      created: totals.created,
      updated: totals.updated,
      deleted: totals.deleted,
      error: null,
    };
  }
  const firstError = jobs.find((j) => j.error)?.error ?? null;
  return {
    active: false,
    collectionName: null,
    status: firstError ? "failed" : "completed",
    created: totals.created,
    updated: totals.updated,
    deleted: totals.deleted,
    error: firstError,
  };
}

function singleJobView(job: SyncJob): AggregateView {
  return {
    active: job.active,
    collectionName: job.collectionName,
    status: job.status,
    created: job.created,
    updated: job.updated,
    deleted: job.deleted,
    error: job.error,
  };
}

export default function SyncProgress({ collectionName, onComplete }: SyncProgressProps) {
  const [view, setView] = useState<AggregateView | null>(null);
  const intervalRef = useRef<number | null>(null);
  // Guard against the race where the first poll returns no active jobs
  // (idle initial state) before the server has registered the new job.
  const hasSeenActiveRef = useRef(false);

  useEffect(() => {
    const poll = () => {
      fetch("/api/sync/jobs")
        .then((r) => r.json())
        .then((jobs: SyncJob[]) => {
          const scoped = collectionName
            ? jobs.filter((j) => j.collectionName === collectionName)
            : jobs;
          const next = collectionName && scoped.length > 0
            ? singleJobView(scoped[0])
            : aggregate(scoped);
          setView(next);
          if (next.active) hasSeenActiveRef.current = true;
          if (!next.active && hasSeenActiveRef.current) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            onComplete({
              created: next.created,
              updated: next.updated,
              deleted: next.deleted,
              error: next.error,
            });
          }
        })
        .catch(() => {});
    };

    poll();
    intervalRef.current = window.setInterval(poll, 500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [collectionName, onComplete]);

  if (!view) return null;

  return (
    <div className="sync-progress">
      <div className="sync-progress-header">
        <span className={`status-badge status-${view.active ? "running" : view.error ? "failed" : "completed"}`}>
          {view.active ? "Syncing" : view.error ? "Failed" : "Done"}
        </span>
        {view.collectionName && (
          <span className="sync-progress-collection">{view.collectionName}</span>
        )}
      </div>
      <div className="sync-progress-counters">
        <span className="counter counter-created">{view.created} created</span>
        <span className="counter counter-updated">{view.updated} updated</span>
        <span className="counter counter-deleted">{view.deleted} deleted</span>
      </div>
      {view.status && view.status !== "idle" && (
        <div className="sync-progress-status">{view.status}</div>
      )}
      {view.error && (
        <div className="form-error">{view.error}</div>
      )}
    </div>
  );
}
