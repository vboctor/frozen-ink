import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import {
  ensureInitialized,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  getFrozenInkHome,
  entities,
  syncRuns,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
} from "@frozenink/core";
import {
  createDefaultRegistry,
  gitHubTheme,
  obsidianTheme,
  gitTheme,
  mantisBTTheme,
} from "@frozenink/crawlers";
import { sql, desc } from "drizzle-orm";

type SyncMode = "skip" | "incremental" | "full";
type ViewMode = "select" | "syncing" | "done";

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
  const dbPath = getCollectionDbPath(name);
  if (!existsSync(dbPath)) return "never";
  try {
    const colDb = getCollectionDb(dbPath);
    const runs = colDb.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1).all();
    if (runs.length > 0 && runs[0].startedAt) {
      const d = new Date(runs[0].startedAt + "Z");
      if (!isNaN(d.getTime())) return formatRelative(d);
    }
  } catch {}
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

export function SyncView(): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("select");
  const [progress, setProgress] = useState<string[]>([]);
  const [syncModes, setSyncModes] = useState<Map<string, SyncMode>>(new Map());
  const [totalStats, setTotalStats] = useState<{ created: number; updated: number; deleted: number; total: number } | null>(null);
  const [fetchedCount, setFetchedCount] = useState(0);
  const [syncingCollection, setSyncingCollection] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [syncStartTime, setSyncStartTime] = useState<number | null>(null);

  // Tick elapsed time every second while syncing
  useEffect(() => {
    if (syncStartTime === null) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - syncStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [syncStartTime]);

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

  const startSync = useCallback(async () => {
    const toSync = collections.filter((c: { name: string }) => {
      const m = syncModes.get(c.name);
      return m === "incremental" || m === "full";
    });

    if (toSync.length === 0) return;

    setViewMode("syncing");
    setProgress([]);
    setTotalStats(null);
    setFetchedCount(0);
    const syncStart = Date.now();
    setSyncStartTime(syncStart);

    const home = getFrozenInkHome();
    const registry = createDefaultRegistry();
    const themeEngine = new ThemeEngine();
    themeEngine.register(gitHubTheme);
    themeEngine.register(obsidianTheme);
    themeEngine.register(gitTheme);
    themeEngine.register(mantisBTTheme);

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;
    let totalEntities = 0;

    for (const col of toSync) {
      const isFullSync = syncModes.get(col.name) === "full";
      const label = isFullSync ? "full sync" : "sync";
      setProgress((p) => [...p, `${label}: "${col.name}" (${col.crawler})...`]);
      setFetchedCount(0);
      setSyncingCollection(true);

      const factory = registry.get(col.crawler);
      if (!factory) {
        setProgress((p) => [...p, `  No crawler for ${col.crawler}, skipping`]);
        setSyncingCollection(false);
        continue;
      }

      const crawler = factory();
      await crawler.initialize(
        col.config as Record<string, unknown>,
        col.credentials as Record<string, unknown>,
      );

      const dbPath = getCollectionDbPath(col.name);
      const collectionDir = join(home, "collections", col.name);

      if (isFullSync) {
        const contentDir = join(collectionDir, "content");
        const dbDir = join(collectionDir, "db");
        if (existsSync(contentDir)) rmSync(contentDir, { recursive: true, force: true });
        if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true });
        setProgress((p) => [...p, "  Cleared data for full re-sync"]);
      }
      const storage = new LocalStorageBackend(collectionDir);

      const engine = new SyncEngine({
        crawler,
        dbPath,
        collectionName: col.name,
        themeEngine,
        storage,
        markdownBasePath: "content",
        assetConfig: col.assets as { extensions?: string[]; maxSize?: number } | undefined,
        onBatchFetched: ({ externalIds }: { externalIds: string[] }) => {
          if (externalIds.length > 0) {
            setFetchedCount((c) => c + externalIds.length);
          }
        },
      });

      try {
        const stats = await engine.run();
        setSyncingCollection(false);
        const colDb = getCollectionDb(dbPath);
        const [{ total }] = colDb.select({ total: sql<number>`count(*)` }).from(entities).all();
        totalCreated += stats.created;
        totalUpdated += stats.updated;
        totalDeleted += stats.deleted;
        totalEntities += total;
        const colElapsed = formatElapsed(Date.now() - syncStart);
        setProgress((p) => [...p, `  +${stats.created} ~${stats.updated} -${stats.deleted} (${total} total) in ${colElapsed}`]);
      } catch (err) {
        setSyncingCollection(false);
        const msg = err instanceof Error ? err.message : String(err);
        setProgress((p) => [...p, `  Error: ${msg}`]);
      }

      await crawler.dispose();
    }

    const totalElapsed = Date.now() - syncStart;
    setElapsedMs(totalElapsed);
    setSyncStartTime(null); // stop the timer

    // Only show combined totals when multiple collections were synced
    if (toSync.length > 1) {
      setTotalStats({ created: totalCreated, updated: totalUpdated, deleted: totalDeleted, total: totalEntities });
    }
    setViewMode("done");
  }, [collections, syncModes]);

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
      if (key.return) startSync();
    }
    if (viewMode === "done") {
      if (key.return || key.escape) {
        setViewMode("select");
        setProgress([]);
        setTotalStats(null);
        // Reset all to skip
        setAllMode("skip");
      }
    }
  });

  if (collections.length === 0) {
    return (
      <Box paddingY={1}>
        <Text dimColor>No enabled collections to sync.</Text>
      </Box>
    );
  }

  if (viewMode === "syncing" || viewMode === "done") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>{viewMode === "syncing" ? "Syncing..." : "Sync Complete"}</Text>
        <Box flexDirection="column" marginLeft={1} marginTop={1}>
          {progress.map((line, i) => (
            <Text key={i} dimColor={viewMode === "done"}>{line}</Text>
          ))}
          {syncingCollection && fetchedCount > 0 && (
            <Text dimColor>  Fetched {fetchedCount} entities... ({formatElapsed(elapsedMs)})</Text>
          )}
        </Box>
        {totalStats && (
          <Box marginTop={1} gap={2}>
            <Text color="green">+{totalStats.created}</Text>
            <Text color="yellow">~{totalStats.updated}</Text>
            <Text color="red">-{totalStats.deleted}</Text>
            <Text dimColor>({totalStats.total} total)</Text>
          </Box>
        )}
        {viewMode === "done" && (
          <Box marginTop={1}><Text dimColor>Press Enter to continue</Text></Box>
        )}
      </Box>
    );
  }

  const selectedCount = [...syncModes.values()].filter((m) => m !== "skip").length;

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
          const checkbox = mode === "skip" ? "[ ] " : mode === "incremental" ? "[s] " : "[f] ";
          const checkColor = mode === "skip" ? "gray" : mode === "incremental" ? "green" : "yellow";
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
      </Box>
    </Box>
  );
}
