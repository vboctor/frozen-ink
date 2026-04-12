import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, renameSync, rmSync } from "fs";
import { join, basename } from "path";
import {
  ensureInitialized,
  listCollections,
  listSites,
  getCollection,
  getCollectionDb,
  getCollectionDbPath,
  getFrozenInkHome,
  updateCollection,
  removeCollection,
  renameCollection,
  isValidCollectionKey,
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
import { desc, sql } from "drizzle-orm";
import { TextInput } from "./TextInput.js";
import { AddCollection } from "./AddCollection.js";
import { ExportView } from "./ExportView.js";
import { SearchView } from "./SearchView.js";
import { McpConfigView } from "./McpConfigView.js";
import type { Screen } from "./App.js";

type Mode =
  | "list"
  | "edit"
  | "add"
  | "export"
  | "search"
  | "mcp"
  | "confirm-delete"
  | "confirm-full-sync"
  | "syncing";

// Fixed-width columns
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

interface RowStats {
  entityCount: string;
  lastSync: string;
}

function getRowStats(name: string): RowStats {
  const dbPath = getCollectionDbPath(name);
  if (!existsSync(dbPath)) return { entityCount: "—", lastSync: "—" };
  try {
    const colDb = getCollectionDb(dbPath);
    const [{ total }] = colDb.select({ total: sql<number>`count(*)` }).from(entities).all();
    const runs = colDb.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1).all();
    let lastSync = "never";
    if (runs.length > 0 && runs[0].startedAt) {
      const d = new Date(runs[0].startedAt + "Z");
      if (!isNaN(d.getTime())) {
        lastSync = formatRelative(d);
        if (runs[0].status === "failed") lastSync += " (failed)";
      }
    }
    return { entityCount: String(total), lastSync };
  } catch {
    return { entityCount: "err", lastSync: "—" };
  }
}

function getSourceDetails(crawler: string, config: Record<string, unknown>): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string }> = [];
  switch (crawler) {
    case "github": {
      const owner = config.owner as string | undefined;
      const repo = config.repo as string | undefined;
      if (owner && repo) details.push({ label: "Repository", value: `${owner}/${repo}` });
      if (config.openOnly) details.push({ label: "Filter", value: "open issues/PRs only" });
      if (config.maxIssues) details.push({ label: "Max issues", value: String(config.maxIssues) });
      if (config.maxPullRequests) details.push({ label: "Max PRs", value: String(config.maxPullRequests) });
      if (config.syncComments === false) details.push({ label: "Comments", value: "disabled" });
      break;
    }
    case "obsidian": {
      const vaultPath = config.vaultPath as string | undefined;
      if (vaultPath) {
        details.push({ label: "Vault", value: basename(vaultPath) });
        details.push({ label: "Path", value: vaultPath });
      }
      break;
    }
    case "git": {
      const repoPath = config.repoPath as string | undefined;
      if (repoPath) {
        details.push({ label: "Repository", value: basename(repoPath) });
        details.push({ label: "Path", value: repoPath });
      }
      if (config.includeDiffs) details.push({ label: "Diffs", value: "included" });
      break;
    }
    case "mantisbt": {
      const url = (config.url ?? config.baseUrl) as string | undefined;
      if (url) details.push({ label: "URL", value: url });
      const project = config.project as { id?: number; name?: string } | undefined;
      const projName = project?.name ?? (config.projectName as string | undefined);
      const projId = project?.id ?? (config.projectId as number | undefined);
      if (projName || projId) {
        const value = projName && projId ? `${projName} (id: ${projId})` : projName ?? String(projId);
        details.push({ label: "Project", value });
      }
      if (config.maxEntities) details.push({ label: "Max entities", value: String(config.maxEntities) });
      break;
    }
  }
  return details;
}

/** Editable fields per crawler type */
interface EditField {
  key: string;
  label: string;
  type: "number" | "boolean";
  configKey: string;
}

function getEditableFields(crawler: string): EditField[] {
  switch (crawler) {
    case "github":
      return [
        { key: "title", label: "Display title", type: "number" as const, configKey: "" },
        { key: "openOnly", label: "Open issues/PRs only", type: "boolean", configKey: "openOnly" },
        { key: "maxIssues", label: "Max issues", type: "number", configKey: "maxIssues" },
        { key: "maxPrs", label: "Max pull requests", type: "number", configKey: "maxPullRequests" },
        { key: "syncComments", label: "Sync comments", type: "boolean", configKey: "syncComments" },
        { key: "syncCheckStatuses", label: "Sync check statuses", type: "boolean", configKey: "syncCheckStatuses" },
      ];
    case "git":
      return [
        { key: "title", label: "Display title", type: "number" as const, configKey: "" },
        { key: "includeDiffs", label: "Include commit diffs", type: "boolean", configKey: "includeDiffs" },
      ];
    case "mantisbt":
      return [
        { key: "title", label: "Display title", type: "number" as const, configKey: "" },
        { key: "maxEntities", label: "Max entities", type: "number", configKey: "maxEntities" },
      ];
    case "obsidian":
      return [
        { key: "title", label: "Display title", type: "number" as const, configKey: "" },
      ];
    default:
      return [
        { key: "title", label: "Display title", type: "number" as const, configKey: "" },
      ];
  }
}

// ── CollectionEdit sub-screen ──────────────────────────────────────────

function CollectionEdit({
  collectionName,
  onDone,
}: {
  collectionName: string;
  onDone: () => void;
}): React.ReactElement {
  // All hooks must be called before any early return
  const [editCursor, setEditCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const col = getCollection(collectionName);
  const config = col ? (col.config as Record<string, unknown>) : {};
  const fields = col ? getEditableFields(col.crawler) : [];
  const sourceDetails = col ? getSourceDetails(col.crawler, config) : [];

  function getCurrentValue(field: EditField): string {
    if (!col) return "";
    if (field.key === "title") return col.title || "";
    const val = config[field.configKey];
    if (val === undefined || val === null) return "";
    return String(val);
  }

  function getCurrentDisplay(field: EditField): string {
    if (!col) return "";
    if (field.key === "title") return col.title || "(none)";
    const val = config[field.configKey];
    if (field.type === "boolean") {
      if (val === true) return "yes";
      if (val === false) return "no";
      return "(default)";
    }
    if (val === undefined || val === null) return "(default)";
    return String(val);
  }

  useInput((input, key) => {
    if (!col || editing) return;

    if (key.escape) {
      onDone();
      return;
    }
    if (key.upArrow) setEditCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setEditCursor((c) => Math.min(fields.length - 1, c + 1));
    if (key.return && fields[editCursor]) {
      const field = fields[editCursor];
      if (field.type === "boolean" && field.key !== "title") {
        const current = config[field.configKey];
        const newVal = current === true ? false : true;
        const newConfig = { ...config, [field.configKey]: newVal };
        updateCollection(collectionName, { config: newConfig });
        setSaved(true);
        setRefreshKey((k) => k + 1);
        setTimeout(() => setSaved(false), 1500);
      } else {
        setInputValue(getCurrentValue(field));
        setEditing(true);
      }
    }
  });

  const handleEditSubmit = useCallback(() => {
    if (!col) return;
    const field = fields[editCursor];
    if (!field) { setEditing(false); return; }
    const val = inputValue.trim();

    if (field.key === "title") {
      updateCollection(collectionName, { title: val || undefined });
    } else if (field.type === "number") {
      const newConfig = { ...config };
      if (val === "") {
        delete newConfig[field.configKey];
      } else {
        const n = parseInt(val, 10);
        if (!isNaN(n)) newConfig[field.configKey] = n;
      }
      updateCollection(collectionName, { config: newConfig });
    }

    setEditing(false);
    setSaved(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setSaved(false), 1500);
  }, [editCursor, inputValue, fields, config, collectionName, col]);

  if (!col) return <Text color="red">Collection not found.</Text>;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box gap={2}>
        <Text bold>{col.title || col.name}</Text>
        <Text dimColor>({col.crawler})</Text>
        {saved && <Text color="green">Saved</Text>}
      </Box>

      {sourceDetails.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {sourceDetails.map((d) => (
            <Text key={d.label}>
              <Text dimColor>{d.label}: </Text>
              <Text>{d.value}</Text>
            </Text>
          ))}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>Settings</Text>
        {fields.map((field, i) => {
          if (editing && i === editCursor) {
            return (
              <Box key={field.key}>
                <TextInput
                  label={field.label}
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={handleEditSubmit}
                />
              </Box>
            );
          }

          const display = getCurrentDisplay(field);
          const isBool = field.type === "boolean" && field.key !== "title";
          return (
            <Box key={field.key} gap={1}>
              <Text color={i === editCursor ? "cyan" : undefined}>
                {i === editCursor ? "❯" : " "}
              </Text>
              <Text>{field.label}:</Text>
              <Text bold color={isBool ? (display === "yes" ? "green" : "gray") : "cyan"}>
                {display}
              </Text>
              {isBool && i === editCursor && <Text dimColor>(Enter to toggle)</Text>}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate  Enter edit/toggle  ESC back</Text>
      </Box>
    </Box>
  );
}

// ── Main CollectionList ────────────────────────────────────────────────

export function CollectionList({
  onNavigate,
}: {
  onNavigate?: (screen: Screen) => void;
}): React.ReactElement {
  // ── All hooks MUST be declared before any conditional returns ──
  const [mode, setMode] = useState<Mode>("list");
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncProgress, setSyncProgress] = useState<string[]>([]);
  const [syncFetchedCounts, setSyncFetchedCounts] = useState<Record<string, number>>({});
  const [syncStartTime, setSyncStartTime] = useState<number | null>(null);
  const [syncElapsedMs, setSyncElapsedMs] = useState(0);
  const [editingCollection, setEditingCollection] = useState("");

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (syncStartTime === null) return;
    const interval = setInterval(() => {
      setSyncElapsedMs(Date.now() - syncStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [syncStartTime]);

  ensureInitialized();
  const collections = listCollections();
  const allSites = listSites();
  const current = collections[cursor] ?? null;

  // Detail stats for selected collection
  let entityCount = 0;
  let entityTypeCounts: Array<{ type: string; count: number }> = [];
  let collectionSize = "";
  let lastRun: {
    status: string;
    startedAt: string | null;
    entitiesCreated: number;
    entitiesUpdated: number;
    entitiesDeleted: number;
  } | null = null;
  let lastSyncTime = "";
  if (current && mode === "list") {
    const dbPath = getCollectionDbPath(current.name);
    if (existsSync(dbPath)) {
      try {
        const colDb = getCollectionDb(dbPath);
        const [{ total }] = colDb.select({ total: sql<number>`count(*)` }).from(entities).all();
        entityCount = total;

        // Per-type breakdown
        const typeCounts = colDb
          .select({
            type: entities.entityType,
            count: sql<number>`count(*)`,
          })
          .from(entities)
          .groupBy(entities.entityType)
          .orderBy(sql`count(*) desc`)
          .all();
        entityTypeCounts = typeCounts.map((r: any) => ({ type: r.type, count: r.count }));

        // Collection directory size
        const home = getFrozenInkHome();
        const colDir = join(home, "collections", current.name);
        if (existsSync(colDir)) {
          try {
            const { execSync } = require("child_process");
            const sizeStr = execSync(`du -sh "${colDir}" 2>/dev/null`, { encoding: "utf8" }).trim().split(/\s/)[0];
            if (sizeStr) collectionSize = sizeStr;
          } catch { /* ignore */ }
        }

        const runs = colDb.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1).all();
        if (runs.length > 0) {
          lastRun = runs[0];
          if (runs[0].startedAt) {
            const d = new Date(runs[0].startedAt + "Z");
            if (!isNaN(d.getTime())) lastSyncTime = formatRelative(d);
          }
        }
      } catch { /* ignore */ }
    }
  }

  const relatedSites = current
    ? allSites.filter((d: { collections: string[] }) => d.collections.includes(current.name))
    : [];

  const sourceDetails = current
    ? getSourceDetails(current.crawler, current.config as Record<string, unknown>)
    : [];

  const startSync = useCallback(async (collectionName?: string, syncType?: "full" | "incremental") => {
    const col = collectionName ? getCollection(collectionName) : current;
    const name = collectionName ?? current?.name;
    if (!col || !name) return;
    setMode("syncing");
    const syncLabel = syncType === "full" ? "Full sync" : "Syncing";
    setSyncProgress([`${syncLabel} "${name}" (${col.crawler})...`]);
    setSyncFetchedCounts({});
    const syncStart = Date.now();
    setSyncStartTime(syncStart);
    try {
      const registry = createDefaultRegistry();
      const themeEngine = new ThemeEngine();
      themeEngine.register(gitHubTheme);
      themeEngine.register(obsidianTheme);
      themeEngine.register(gitTheme);
      themeEngine.register(mantisBTTheme);
      const factory = registry.get(col.crawler);
      if (!factory) { setSyncProgress((p) => [...p, `No crawler for ${col.crawler}`]); setSyncStartTime(null); setMode("list"); return; }
      const crawler = factory();
      await crawler.initialize(col.config as Record<string, unknown>, col.credentials as Record<string, unknown>);
      const home = getFrozenInkHome();
      const dbPath = getCollectionDbPath(name);
      const collectionDir = join(home, "collections", name);
      const storage = new LocalStorageBackend(collectionDir);
      const engine = new SyncEngine({
        crawler, dbPath, collectionName: name, themeEngine, storage, markdownBasePath: "content",
        assetConfig: col.assets as { extensions?: string[]; maxSize?: number } | undefined,
        onBatchFetched: ({ externalIds, entityTypes }: { externalIds: string[]; entityTypes: string[] }) => {
          if (externalIds.length > 0) {
            setSyncFetchedCounts((prev) => {
              const next = { ...prev };
              for (const t of entityTypes) {
                next[t] = (next[t] ?? 0) + 1;
              }
              return next;
            });
          }
        },
        onVersionUpdate: (version: string) => {
          updateCollection(name, { version });
        },
      });
      const stats = await engine.run({ syncType: syncType ?? "incremental" });
      setSyncFetchedCounts({});
      const elapsed = formatElapsed(Date.now() - syncStart);
      const colDb = getCollectionDb(dbPath);
      const [{ total }] = colDb.select({ total: sql<number>`count(*)` }).from(entities).all();
      setSyncProgress((p) => [...p, `+${stats.created} ~${stats.updated} -${stats.deleted} (${total} total) in ${elapsed}`]);
      await crawler.dispose();
      setMessage(`Sync complete for "${name}"`);
    } catch (err) {
      setSyncFetchedCounts({});
      setSyncProgress((p) => [...p, `Error: ${err instanceof Error ? err.message : String(err)}`]);
    }
    setSyncStartTime(null);
    setMode("list");
    refresh();
  }, [current, refresh]);

  const handleRenameSubmit = useCallback(() => {
    if (!current || !inputValue) { setMode("list"); return; }
    if (!isValidCollectionKey(inputValue)) { setMessage("Invalid key. Use letters, numbers, dashes, underscores."); setMode("list"); return; }
    if (getCollection(inputValue)) { setMessage(`"${inputValue}" already exists.`); setMode("list"); return; }
    const home = getFrozenInkHome();
    const oldDir = join(home, "collections", current.name);
    const newDir = join(home, "collections", inputValue);
    if (existsSync(oldDir)) renameSync(oldDir, newDir);
    renameCollection(current.name, inputValue);
    setMessage(`Renamed "${current.name}" → "${inputValue}"`);
    setMode("list");
    refresh();
  }, [current, inputValue, refresh, cursor]);

  useInput((input, key) => {
    // Only handle input in list/confirm-delete modes; sub-screens handle their own input
    if (mode === "list") {
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCursor((c) => Math.min(collections.length - 1, c + 1));
      if (input === " " && current) {
        updateCollection(current.name, { enabled: !current.enabled });
        refresh();
      }
      if (key.return && current) {
        setEditingCollection(current.name);
        setMode("edit");
      }
      if (input === "a") setMode("add");
      if (input === "x" && current) setMode("confirm-delete");
      if (input === "s" && current) {
        const registry = createDefaultRegistry();
        const factory = registry.get(current.crawler);
        const crawlerVersion = factory ? factory().metadata.version ?? "1.0" : "1.0";
        const collectionVersion = current.version ?? "1.0";
        const compat = SyncEngine.checkVersionCompat(collectionVersion, crawlerVersion);
        if (compat === "full-sync") {
          setMessage(`Version mismatch (${collectionVersion} → ${crawlerVersion}). Full sync required.`);
          setMode("confirm-full-sync");
        } else {
          startSync();
        }
      }
      if (input === "e" && current) { setEditingCollection(current.name); setMode("export"); }
      if (input === "f" && current) { setEditingCollection(current.name); setMode("search"); }
      if (input === "m" && current) { setEditingCollection(current.name); setMode("mcp"); }
    } else if (mode === "confirm-full-sync") {
      if (input === "y" && current) {
        startSync(undefined, "full");
      } else {
        setMessage("");
        setMode("list");
      }
    } else if (mode === "confirm-delete") {
      if (input === "y" && current) {
        const home = getFrozenInkHome();
        const dir = join(home, "collections", current.name);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        removeCollection(current.name);
        setMessage(`Deleted "${current.name}"`);
        setCursor(Math.max(0, cursor - 1));
        setMode("list");
        refresh();
      } else {
        setMessage("");
        setMode("list");
      }
    }
  });

  // ── All hooks are above this line ──

  if (mode === "add") {
    return <AddCollection onDone={() => { setMode("list"); refresh(); }} onSync={(name) => {
      refresh();
      startSync(name);
    }} />;
  }

  if (mode === "edit" && editingCollection) {
    return <CollectionEdit collectionName={editingCollection} onDone={() => { setMode("list"); refresh(); }} />;
  }

  if (mode === "export" && editingCollection) {
    return <ExportView collectionName={editingCollection} onDone={() => { setMode("list"); }} />;
  }

  if (mode === "search" && editingCollection) {
    return <SearchView collectionName={editingCollection} onDone={() => { setMode("list"); }} />;
  }

  if (mode === "confirm-full-sync") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="yellow">{message}</Text>
        <Text>Run full sync? This will re-download all data. (y/n)</Text>
      </Box>
    );
  }

  if (mode === "mcp" && editingCollection) {
    return <McpConfigView collectionName={editingCollection} onDone={() => { setMode("list"); refresh(); }} />;
  }

  if (mode === "syncing") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold color="yellow">Syncing...</Text>
        <Box flexDirection="column" marginLeft={1} marginTop={1}>
          {syncProgress.map((line, i) => <Text key={i} dimColor>{line}</Text>)}
          {Object.keys(syncFetchedCounts).length > 0 && (() => {
            const total = Object.values(syncFetchedCounts).reduce((a, b) => a + b, 0);
            const breakdown = Object.entries(syncFetchedCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => `${count} ${type}${count !== 1 ? "s" : ""}`)
              .join(", ");
            return <Text dimColor>  Fetched {total} entities: {breakdown}. ({formatElapsed(syncElapsedMs)})</Text>;
          })()}
        </Box>
      </Box>
    );
  }

  if (collections.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text dimColor>No collections configured.</Text>
        <Box marginTop={1}><Text dimColor>Press [a] to add one.</Text></Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Collections</Text>

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
          const stats = getRowStats(col.name);
          const selected = i === cursor;
          const checkbox = col.enabled ? "[x] " : "[ ] ";
          return (
            <Box key={col.name}>
              <Text color={selected ? "cyan" : undefined}>{selected ? "❯ " : "  "}</Text>
              <Text color={col.enabled ? "green" : "gray"}>{pad(checkbox, W_CHECK)}</Text>
              <Text bold={selected} color={!col.enabled ? "gray" : selected ? "cyan" : undefined}>{pad(col.name, W_NAME)}</Text>
              <Text dimColor>{pad(col.title || "", W_TITLE)}</Text>
              <Text dimColor>{pad(col.crawler, W_TYPE)}</Text>
              <Text color={!col.enabled ? "gray" : undefined}>{pad(stats.entityCount, W_ENTITIES)}</Text>
              <Text dimColor>{stats.lastSync}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Detail panel */}
      {current && (
        <Box flexDirection="column" marginTop={1} marginLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
          <Box gap={2}>
            <Text bold>{current.title || current.name}</Text>
            <Text dimColor>({current.crawler})</Text>
          </Box>
          {sourceDetails.length > 0 && (
            <Box flexDirection="column">
              {sourceDetails.map((d) => (
                <Text key={d.label}><Text dimColor>{d.label}: </Text><Text>{d.value}</Text></Text>
              ))}
            </Box>
          )}
          <Text>
            <Text dimColor>Content: </Text>
            <Text bold>{entityCount}</Text>
            <Text> entities</Text>
            {entityTypeCounts.length > 0 && (
              <Text> - {entityTypeCounts.map((t) => `${t.count} ${t.type}${t.count !== 1 ? "s" : ""}`).join(", ")}</Text>
            )}
            {collectionSize ? <Text> - {collectionSize}</Text> : null}
          </Text>
          {lastRun ? (
            <Box gap={2}>
              <Text>Last sync: <Text dimColor>{lastSyncTime}</Text> <Text color={lastRun.status === "completed" ? "green" : "red"}>({lastRun.status})</Text></Text>
              <Text><Text color="green">+{lastRun.entitiesCreated}</Text> <Text color="yellow">~{lastRun.entitiesUpdated}</Text> <Text color="red">-{lastRun.entitiesDeleted}</Text></Text>
            </Box>
          ) : (
            <Text dimColor>No sync runs yet</Text>
          )}
          {relatedSites.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor bold>Sites:</Text>
              {relatedSites.map((site: { name: string; url: string; password?: { protected: boolean } }) => (
                <Box key={site.name} gap={1} marginLeft={1}>
                  <Text>{site.name}</Text>
                  <Text dimColor>→</Text>
                  <Text color="blue">{site.url}</Text>
                  <Text color={site.password?.protected ? "green" : "yellow"}>[{site.password?.protected ? "protected" : "public"}]</Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      {mode === "confirm-delete" && (
        <Box marginTop={1}>
          <Text color="red">Delete "{current?.name}" and all its data? (y/N)</Text>
        </Box>
      )}

      {message && <Box marginTop={1}><Text color="green">{message}</Text></Box>}

      <Box marginTop={1} gap={2}>
        <Text dimColor>[Enter] Edit</Text>
        <Text dimColor>[s] Sync</Text>
        <Text dimColor>[f] Search</Text>
        <Text dimColor>[e] Export</Text>
        <Text dimColor>[m] MCP</Text>
        <Text dimColor>[Space] Toggle</Text>
        <Text dimColor>[a] Add</Text>
        <Text dimColor>[x] Delete</Text>
      </Box>
    </Box>
  );
}
