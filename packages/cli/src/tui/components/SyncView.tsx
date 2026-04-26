import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync } from "fs";
import {
  ensureInitialized,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  getCollectionSyncState,
  entities,
} from "@frozenink/core";
import { sql } from "drizzle-orm";
import {
  listJobs,
  startSync,
  subscribe,
  isActive,
  type TuiSyncJob,
} from "../sync-jobs.js";

type SyncMode = "skip" | "incremental" | "full";
type ViewMode = "select" | "syncing";

const W_CHECK = 6;
const W_NAME = 20;
const W_TITLE = 22;
const W_TYPE = 12;
const W_ENTITIES = 10;

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width - 1) + " ";
  return text + " ".repeat(width - text.length);
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function getLastSync(name: string): string {
  const lastSyncAt = getCollectionSyncState(getCollectionDbPath(name)).lastAt;
  if (lastSyncAt) {
    const d = new Date(lastSyncAt + "Z");
    if (!isNaN(d.getTime())) return formatRelative(d);
  }
  return "never";
}

function getEntityCount(name: string): string {
  const dbPath = getCollectionDbPath(name);
  if (!existsSync(dbPath)) return "—";
  try {
    const colDb = getCollectionDb(dbPath);
    const [{ total }] = colDb.select({ total: sql<number>`count(*)` }).from(entities).all();
    return String(total);
  } catch {
    return "err";
  }
}

/** Subscribe to the shared store and re-render when jobs change. */
function useJobs(): TuiSyncJob[] {
  const [snapshot, setSnapshot] = useState<TuiSyncJob[]>(() => listJobs());
  useEffect(() => subscribe(() => setSnapshot(listJobs())), []);
  // Tick every second so the elapsed time updates in the UI.
  useEffect(() => {
    const id = setInterval(() => setSnapshot(listJobs()), 1000);
    return () => clearInterval(id);
  }, []);
  return snapshot;
}

export function SyncView(): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("select");
  const [syncModes, setSyncModes] = useState<Map<string, SyncMode>>(new Map());
  const jobs = useJobs();

  ensureInitialized();
  const collections = listCollections().filter((c: { enabled: boolean }) => c.enabled);

  // Initialize sync modes for new collections
  if (syncModes.size === 0 && collections.length > 0) {
    const initial = new Map<string, SyncMode>();
    for (const col of collections) initial.set(col.name, "skip");
    setSyncModes(initial);
  }

  const cycleSyncMode = useCallback((name: string) => {
    setSyncModes((prev) => {
      const next = new Map(prev);
      const current = next.get(name) || "skip";
      const order: SyncMode[] = ["skip", "incremental", "full"];
      const idx = order.indexOf(current);
      next.set(name, order[(idx + 1) % 3]);
      return next;
    });
  }, []);

  const setAllMode = useCallback((mode: SyncMode) => {
    setSyncModes((prev) => {
      const next = new Map(prev);
      for (const [key] of next) next.set(key, mode);
      return next;
    });
  }, []);

  const startAll = useCallback(() => {
    const toSync = collections.filter((c: { name: string }) => {
      const m = syncModes.get(c.name);
      return m === "incremental" || m === "full";
    });
    if (toSync.length === 0) return;
    for (const c of toSync) {
      if (isActive(c.name)) continue;
      startSync(c.name, syncModes.get(c.name) === "full" ? "full" : "incremental");
    }
    setViewMode("syncing");
    // Reset selections so a second round starts from a clean slate.
    setAllMode("skip");
  }, [collections, syncModes, setAllMode]);

  useInput((input, key) => {
    if (viewMode === "select") {
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCursor((c) => Math.min(collections.length - 1, c + 1));
      if (input === " " && collections[cursor]) {
        cycleSyncMode(collections[cursor].name);
      }
      if (input === "s" && collections[cursor]) {
        setSyncModes((prev) => { const next = new Map(prev); next.set(collections[cursor].name, "incremental"); return next; });
      }
      if (input === "f" && collections[cursor]) {
        setSyncModes((prev) => { const next = new Map(prev); next.set(collections[cursor].name, "full"); return next; });
      }
      if (input === "n" && collections[cursor]) {
        setSyncModes((prev) => { const next = new Map(prev); next.set(collections[cursor].name, "skip"); return next; });
      }
      if (input === "S") setAllMode("incremental");
      if (input === "F") setAllMode("full");
      if (input === "N") setAllMode("skip");
      if (key.return) startAll();
      if (input === "v" && jobs.length > 0) setViewMode("syncing");
    } else if (viewMode === "syncing") {
      // [b]ack to selection — jobs keep running in the background.
      if (input === "b" || key.escape) setViewMode("select");
    }
  });

  if (collections.length === 0) {
    return (
      <Box paddingY={1}>
        <Text dimColor>No enabled collections to sync.</Text>
      </Box>
    );
  }

  if (viewMode === "syncing") {
    const activeCount = jobs.filter((j) => j.active).length;
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>
          Sync Jobs {activeCount > 0 ? `(${activeCount} running)` : "(all complete)"}
        </Text>
        <Box flexDirection="column" marginLeft={1} marginTop={1}>
          {jobs.length === 0 && <Text dimColor>No jobs.</Text>}
          {jobs.map((job) => {
            const elapsed = job.active
              ? Date.now() - job.startedAt
              : (job.completedAt ?? Date.now()) - job.startedAt;
            const state = job.active ? "running" : job.error ? "failed" : "done";
            const stateColor = state === "running" ? "cyan" : state === "failed" ? "red" : "green";
            return (
              <Box key={job.collectionName} flexDirection="column" marginBottom={1}>
                <Box gap={1}>
                  <Text color={stateColor} bold>●</Text>
                  <Text bold>{job.collectionName}</Text>
                  <Text dimColor>({job.crawler}, {job.mode})</Text>
                  <Text dimColor>{formatElapsed(elapsed)}</Text>
                </Box>
                <Box marginLeft={2} gap={2}>
                  <Text color="green">+{job.created}</Text>
                  <Text color="yellow">~{job.updated}</Text>
                  <Text color="red">-{job.deleted}</Text>
                  {job.fetched > 0 && job.active && (
                    <Text dimColor>fetched {job.fetched}</Text>
                  )}
                </Box>
                {job.status && (
                  <Box marginLeft={2}>
                    <Text dimColor>{job.status}</Text>
                  </Box>
                )}
                {job.error && (
                  <Box marginLeft={2}>
                    <Text color="red">{job.error}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[b/ESC] back to selection — jobs keep running</Text>
        </Box>
      </Box>
    );
  }

  const selectedCount = [...syncModes.values()].filter((m) => m !== "skip").length;
  const activeJobsCount = jobs.filter((j) => j.active).length;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Sync Collections</Text>
      <Text dimColor>Select sync mode per collection: [ ] skip, [s] incremental, [f] full re-sync</Text>

      {/* Table header */}
      <Box marginLeft={1} marginTop={1}>
        <Text dimColor>{pad("", 2)}</Text>
        <Text dimColor>{pad("", W_CHECK)}</Text>
        <Text bold dimColor>{pad("Name", W_NAME)}</Text>
        <Text bold dimColor>{pad("Title", W_TITLE)}</Text>
        <Text bold dimColor>{pad("Type", W_TYPE)}</Text>
        <Text bold dimColor>{pad("Entities", W_ENTITIES)}</Text>
        <Text bold dimColor>Last Sync</Text>
      </Box>

      {/* Table rows */}
      <Box flexDirection="column" marginLeft={1}>
        {collections.map((col: { name: string; title?: string; crawler: string; enabled: boolean }, i: number) => {
          const mode = syncModes.get(col.name) || "skip";
          const selected = i === cursor;
          const running = isActive(col.name);
          const checkbox = running ? "[~] " : mode === "skip" ? "[ ] " : mode === "incremental" ? "[s] " : "[f] ";
          const checkColor = running ? "cyan" : mode === "skip" ? "gray" : mode === "incremental" ? "green" : "yellow";
          return (
            <Box key={col.name}>
              <Text color={selected ? "cyan" : undefined}>{selected ? "❯ " : "  "}</Text>
              <Text color={checkColor}>{pad(checkbox, W_CHECK)}</Text>
              <Text bold={selected} color={selected ? "cyan" : undefined}>{pad(col.name, W_NAME)}</Text>
              <Text dimColor>{pad(col.title || "", W_TITLE)}</Text>
              <Text dimColor>{pad(col.crawler, W_TYPE)}</Text>
              <Text>{pad(getEntityCount(col.name), W_ENTITIES)}</Text>
              <Text dimColor>{getLastSync(col.name)}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} gap={2}>
        <Text dimColor>[Space] Cycle</Text>
        <Text dimColor>[s] Sync</Text>
        <Text dimColor>[f] Full</Text>
        <Text dimColor>[n] Skip</Text>
        <Text dimColor>[S/F/N] All</Text>
        <Text dimColor>[Enter] Start{selectedCount > 0 ? ` (${selectedCount})` : ""}</Text>
        {jobs.length > 0 && (
          <Text color={activeJobsCount > 0 ? "cyan" : "green"}>
            [v] View jobs ({activeJobsCount > 0 ? `${activeJobsCount} running` : `${jobs.length} recent`})
          </Text>
        )}
      </Box>
    </Box>
  );
}
