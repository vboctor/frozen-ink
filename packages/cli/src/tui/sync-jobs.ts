/**
 * Shared store for TUI sync jobs.
 *
 * Holds active and recently completed sync jobs at module scope so that
 * navigating between TUI screens doesn't cancel them — the work runs in
 * background promises here, not tied to any React component lifecycle.
 */
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  getCollection,
  getCollectionDbPath,
  getFrozenInkHome,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
} from "@frozenink/core";
import {
  createDefaultRegistry,
  gitHubTheme,
  obsidianTheme,
  gitTheme,
  mantisHubTheme,
  rssTheme,
} from "@frozenink/crawlers";
import { pullCollection } from "../commands/pull.js";

export type SyncMode = "incremental" | "full";

export interface TuiSyncJob {
  collectionName: string;
  crawler: string;
  mode: SyncMode;
  active: boolean;
  status: string;
  created: number;
  updated: number;
  deleted: number;
  fetched: number;
  error: string | null;
  log: string[];
  startedAt: number;
  completedAt: number | null;
}

const jobs = new Map<string, TuiSyncJob>();
const JOB_RETENTION_MS = 60_000;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function prune() {
  const now = Date.now();
  for (const [name, job] of jobs) {
    if (!job.active && job.completedAt && now - job.completedAt > JOB_RETENTION_MS) {
      jobs.delete(name);
    }
  }
}

export function listJobs(): TuiSyncJob[] {
  prune();
  return [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function activeJobCount(): number {
  prune();
  let n = 0;
  for (const j of jobs.values()) if (j.active) n++;
  return n;
}

export function getJob(name: string): TuiSyncJob | undefined {
  return jobs.get(name);
}

export function isActive(name: string): boolean {
  const j = jobs.get(name);
  return !!j && j.active;
}

export function clearCompletedJobs() {
  for (const [name, job] of jobs) {
    if (!job.active) jobs.delete(name);
  }
  notify();
}

function createThemeEngine(): ThemeEngine {
  const engine = new ThemeEngine();
  engine.register(gitHubTheme);
  engine.register(obsidianTheme);
  engine.register(gitTheme);
  engine.register(mantisHubTheme);
  engine.register(rssTheme);
  return engine;
}

function pushLog(job: TuiSyncJob, line: string) {
  job.log.push(line);
  if (job.log.length > 50) job.log.splice(0, job.log.length - 50);
}

/**
 * Start a sync for `name` in the background. If a sync is already running
 * for that collection, this is a no-op and returns the existing job.
 */
export function startSync(name: string, mode: SyncMode): TuiSyncJob {
  const existing = jobs.get(name);
  if (existing && existing.active) return existing;

  const col = getCollection(name);
  if (!col) {
    const failed: TuiSyncJob = {
      collectionName: name,
      crawler: "?",
      mode,
      active: false,
      status: "failed",
      created: 0,
      updated: 0,
      deleted: 0,
      fetched: 0,
      error: `Collection "${name}" not found`,
      log: [],
      startedAt: Date.now(),
      completedAt: Date.now(),
    };
    jobs.set(name, failed);
    notify();
    return failed;
  }

  const job: TuiSyncJob = {
    collectionName: name,
    crawler: col.crawler,
    mode,
    active: true,
    status: "starting",
    created: 0,
    updated: 0,
    deleted: 0,
    fetched: 0,
    error: null,
    log: [],
    startedAt: Date.now(),
    completedAt: null,
  };
  jobs.set(name, job);
  notify();

  void runJob(job);
  return job;
}

async function runJob(job: TuiSyncJob): Promise<void> {
  const { collectionName: name, mode } = job;
  try {
    const col = getCollection(name);
    if (!col) throw new Error(`Collection "${name}" not found`);

    if (col.crawler === "remote") {
      job.status = "syncing (remote)";
      notify();
      const result = await pullCollection(name, {
        onProgress: (msg) => {
          job.status = msg;
          pushLog(job, msg);
          notify();
        },
      });
      job.created = result.created;
      job.updated = result.updated;
      job.deleted = result.deleted;
    } else {
      const home = getFrozenInkHome();
      const registry = createDefaultRegistry();
      const themeEngine = createThemeEngine();
      const factory = registry.get(col.crawler);
      if (!factory) throw new Error(`No crawler registered for "${col.crawler}"`);

      const crawler = factory();
      try {
        await crawler.initialize(
          col.config as Record<string, unknown>,
          col.credentials as Record<string, unknown>,
        );

        const dbPath = getCollectionDbPath(name);
        const collectionDir = join(home, "collections", name);
        mkdirSync(join(collectionDir, "content"), { recursive: true });

        if (mode === "full") {
          const contentDir = join(collectionDir, "content");
          const dbDir = join(collectionDir, "db");
          if (existsSync(contentDir)) rmSync(contentDir, { recursive: true, force: true });
          if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true });
          mkdirSync(join(collectionDir, "content"), { recursive: true });
          job.status = "cleared for full re-sync";
          pushLog(job, "cleared for full re-sync");
          notify();
        }

        const storage = new LocalStorageBackend(collectionDir);
        const engine = new SyncEngine({
          crawler,
          dbPath,
          collectionName: name,
          themeEngine,
          storage,
          markdownBasePath: "content",
          assetConfig: col.assets as { extensions?: string[]; maxSize?: number } | undefined,
          onBatchFetched: ({ externalIds }) => {
            if (externalIds.length > 0) {
              job.fetched += externalIds.length;
              notify();
            }
          },
          onEntityProcessed: (info) => {
            if (info.created) job.created++;
            if (info.updated) job.updated++;
            notify();
          },
          onProgress: (msg: string) => {
            job.status = msg;
            pushLog(job, msg);
            notify();
          },
        });

        const result = await engine.run({ syncType: mode });
        job.deleted = result.deleted;
      } finally {
        await crawler.dispose();
      }
    }

    job.status = "completed";
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    pushLog(job, `error: ${job.error}`);
  } finally {
    job.active = false;
    job.completedAt = Date.now();
    notify();
  }
}
