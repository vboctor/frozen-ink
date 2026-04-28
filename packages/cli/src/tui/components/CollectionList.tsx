import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, renameSync, rmSync } from "fs";
import { join, basename } from "path";
import {
  ensureInitialized,
  listCollections,
  getCollection,
  getCollectionDb,
  getCollectionDbPath,
  getCollectionPublishState,
  clearCollectionPublishState,
  getFrozenInkHome,
  updateCollection,
  removeCollection,
  renameCollection,
  isValidCollectionKey,
  entities,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
  getCollectionSyncState,
} from "@frozenink/core";
import {
  createDefaultRegistry,
  gitHubTheme,
  obsidianTheme,
  gitTheme,
  mantisHubTheme,
  rssTheme,
  evernoteTheme,
} from "@frozenink/crawlers";
import { sql } from "drizzle-orm";
import { TextInput } from "./TextInput.js";
import { AddCollection } from "./AddCollection.js";
import { ExportView } from "./ExportView.js";
import { SearchView } from "./SearchView.js";
import { McpConfigView } from "./McpConfigView.js";
import { publishCollections, type PublishOptions } from "../../commands/publish.js";
import { unpublishCollection } from "../../commands/unpublish.js";
import { pullCollection } from "../../commands/pull.js";
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
  | "syncing"
  | "publish-menu"
  | "publish-password"
  | "publishing"
  | "publish-done"
  | "confirm-unpublish"
  | "unpublishing";

// Fixed-width columns
const W_CHECK = 6;
const W_NAME = 20;
const W_TITLE = 22;
const W_TYPE = 12;
const W_ENTITIES = 10;
const W_PUBLISHED = 14;

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
  let entityCount = "—";
  if (existsSync(dbPath)) {
    try {
      const colDb = getCollectionDb(dbPath);
      const [{ total }] = colDb.select({ total: sql<number>`count(*)` }).from(entities).all();
      entityCount = String(total);
    } catch {
      entityCount = "err";
    }
  }
  let lastSync = "never";
  const sync = getCollectionSyncState(dbPath);
  if (sync.lastAt) {
    const d = new Date(sync.lastAt + "Z");
    if (!isNaN(d.getTime())) {
      lastSync = formatRelative(d);
      if (sync.lastStatus === "failed") lastSync += " (failed)";
    }
  }
  return { entityCount, lastSync };
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
    case "mantishub": {
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
    case "rss": {
      const feedUrl = config.feedUrl as string | undefined;
      const siteUrl = config.siteUrl as string | undefined;
      if (feedUrl) details.push({ label: "Feed", value: feedUrl });
      if (siteUrl) details.push({ label: "Site", value: siteUrl });
      if (config.maxItems) details.push({ label: "Max items", value: String(config.maxItems) });
      if (config.sitemapBackfill === false) details.push({ label: "Sitemap backfill", value: "disabled" });
      if (config.fetchArticleContent === false) details.push({ label: "Article fetch", value: "disabled" });
      break;
    }
  }
  return details;
}

/** Editable fields per crawler type */
interface EditField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean";
  configKey: string;
}

const DESCRIPTION_FIELD: EditField = {
  key: "description",
  label: "Description (helps AI know when to use this collection)",
  type: "text",
  configKey: "",
};

function getEditableFields(crawler: string): EditField[] {
  switch (crawler) {
    case "github":
      return [
        { key: "title", label: "Display title", type: "text", configKey: "" },
        DESCRIPTION_FIELD,
        { key: "openOnly", label: "Open issues/PRs only", type: "boolean", configKey: "openOnly" },
        { key: "maxIssues", label: "Max issues", type: "number", configKey: "maxIssues" },
        { key: "maxPrs", label: "Max pull requests", type: "number", configKey: "maxPullRequests" },
        { key: "syncComments", label: "Sync comments", type: "boolean", configKey: "syncComments" },
        { key: "syncCheckStatuses", label: "Sync check statuses", type: "boolean", configKey: "syncCheckStatuses" },
      ];
    case "git":
      return [
        { key: "title", label: "Display title", type: "text", configKey: "" },
        DESCRIPTION_FIELD,
        { key: "includeDiffs", label: "Include commit diffs", type: "boolean", configKey: "includeDiffs" },
      ];
    case "mantishub":
      return [
        { key: "title", label: "Display title", type: "text", configKey: "" },
        DESCRIPTION_FIELD,
        { key: "maxEntities", label: "Max entities", type: "number", configKey: "maxEntities" },
      ];
    case "obsidian":
      return [
        { key: "title", label: "Display title", type: "text", configKey: "" },
        DESCRIPTION_FIELD,
      ];
    case "rss":
      return [
        { key: "title", label: "Display title", type: "text", configKey: "" },
        DESCRIPTION_FIELD,
        { key: "maxItems", label: "Max items", type: "number", configKey: "maxItems" },
        { key: "sitemapBackfill", label: "Sitemap backfill", type: "boolean", configKey: "sitemapBackfill" },
        { key: "fetchArticleContent", label: "Fetch article content", type: "boolean", configKey: "fetchArticleContent" },
      ];
    default:
      return [
        { key: "title", label: "Display title", type: "text", configKey: "" },
        DESCRIPTION_FIELD,
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
    if (field.key === "description") return col.description || "";
    const val = config[field.configKey];
    if (val === undefined || val === null) return "";
    return String(val);
  }

  function getCurrentDisplay(field: EditField): string {
    if (!col) return "";
    if (field.key === "title") return col.title || "(none)";
    if (field.key === "description") {
      if (!col.description) return "(none)";
      return col.description.length > 50 ? col.description.slice(0, 50) + "…" : col.description;
    }
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
    if (!col) return;

    // When editing description: Ctrl+S saves; ESC cancels; Enter inserts newline
    if (editing && fields[editCursor]?.key === "description") {
      if (key.escape) {
        setEditing(false);
        setInputValue("");
        return;
      }
      if (key.ctrl && input === "s") {
        handleEditSubmit();
        return;
      }
      if (key.return) {
        setInputValue((v) => v + "\n");
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && !key.escape && !key.upArrow && !key.downArrow && !key.tab && input) {
        setInputValue((v) => v + input);
      }
      return;
    }

    if (editing) return;

    if (key.escape) {
      onDone();
      return;
    }
    if (key.upArrow) setEditCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setEditCursor((c) => Math.min(fields.length - 1, c + 1));
    if (key.return && fields[editCursor]) {
      const field = fields[editCursor];
      if (field.type === "boolean") {
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
    } else if (field.key === "description") {
      updateCollection(collectionName, { description: val || undefined });
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
          const isSelected = i === editCursor;

          // Description field: full-width block with word-wrapped preview/editor
          if (field.key === "description") {
            if (editing && isSelected) {
              // Full-width editing area for description
              const lines = inputValue.split("\n");
              return (
                <Box key={field.key} flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
                  <Text bold color="cyan">{field.label}</Text>
                  <Text dimColor>Ctrl+S to save · ESC to cancel · Enter for new line</Text>
                  <Box marginTop={1} flexDirection="column">
                    {lines.map((line, li) => {
                      const isLast = li === lines.length - 1;
                      return (
                        <Text key={li}>
                          {line}
                          {isLast && <Text color="cyan">█</Text>}
                        </Text>
                      );
                    })}
                  </Box>
                </Box>
              );
            }
            // Description preview (not editing): show full wrapped text when selected
            const desc = col?.description;
            const descLines = desc ? desc.split("\n") : [];
            return (
              <Box key={field.key} flexDirection="column" marginTop={isSelected ? 1 : 0}>
                <Box gap={1}>
                  <Text color={isSelected ? "cyan" : undefined}>{isSelected ? "❯" : " "}</Text>
                  <Text>{field.label}</Text>
                </Box>
                {isSelected && (
                  <Box marginLeft={2} flexDirection="column">
                    {descLines.length > 0 ? (
                      descLines.map((line, li) => (
                        <Text key={li} color="cyan">{line}</Text>
                      ))
                    ) : (
                      <Text dimColor>(none)</Text>
                    )}
                  </Box>
                )}
                {!isSelected && (
                  <Box marginLeft={2} flexDirection="column">
                    {descLines.length > 0 ? (
                      <>
                        {descLines.slice(0, 3).map((line, li) => (
                          <Text key={li} dimColor>{line.length > 80 ? line.slice(0, 79) + "…" : line}</Text>
                        ))}
                        {descLines.length > 3 && <Text dimColor>…</Text>}
                      </>
                    ) : (
                      <Text dimColor>(none)</Text>
                    )}
                  </Box>
                )}
              </Box>
            );
          }

          // All other fields: inline single-line edit
          if (editing && isSelected) {
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
          const isBool = field.type === "boolean";
          return (
            <Box key={field.key} gap={1}>
              <Text color={isSelected ? "cyan" : undefined}>
                {isSelected ? "❯" : " "}
              </Text>
              <Text>{field.label}:</Text>
              <Text bold color={isBool ? (display === "yes" ? "green" : "gray") : "cyan"}>
                {display}
              </Text>
              {isBool && isSelected && <Text dimColor>(Enter to toggle)</Text>}
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
  const [publishLog, setPublishLog] = useState<string[]>([]);
  const [publishStatus, setPublishStatus] = useState("");
  const [publishLastStep, setPublishLastStep] = useState("");
  const [publishError, setPublishError] = useState("");
  const [publishStartTime, setPublishStartTime] = useState<number | null>(null);
  const [publishElapsedMs, setPublishElapsedMs] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const hasSyncedData = useCallback((name: string) => existsSync(getCollectionDbPath(name)), []);

  const startPublish = useCallback((name: string, opts?: { password?: string; removePassword?: boolean }) => {
    const isUpdate = !!getCollectionPublishState(name);
    const password = opts?.password || undefined;
    const removePassword = opts?.removePassword;
    const forcePublic = !password && !removePassword && !isUpdate;
    setEditingCollection(name);
    setPublishLog([]);
    setPublishStatus("");
    setPublishLastStep("");
    setPublishError("");
    setPublishStartTime(Date.now());
    setMode("publishing");
    let lastStep = "";
    let lastDetail = "";
    const addLogEntry = (entry: string) => {
      setPublishLog((log) => log[log.length - 1] === entry ? log : [...log, entry]);
    };
    publishCollections(
      { collectionName: name, password, removePassword, forcePublic },
      (step, detail) => {
        if (step !== lastStep && lastStep) {
          addLogEntry(`[${lastStep}] ${lastDetail} ✓`);
        }
        lastStep = step;
        lastDetail = detail;
        setPublishLastStep(step);
        setPublishStatus(detail);
      },
    ).then(() => {
      if (lastStep) addLogEntry(`[${lastStep}] ${lastDetail} ✓`);
      setPublishStatus("");
      setPublishStartTime(null);
      setMessage(`Published "${name}"`);
      setMode("publish-done");
      refresh();
    }).catch((err) => {
      setPublishStatus("");
      setPublishStartTime(null);
      setPublishError(err instanceof Error ? err.message : String(err));
      setMode("publish-done");
    });
  }, [refresh]);

  useEffect(() => {
    if (syncStartTime === null) return;
    const interval = setInterval(() => {
      setSyncElapsedMs(Date.now() - syncStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [syncStartTime]);

  useEffect(() => {
    if (publishStartTime === null) return;
    const interval = setInterval(() => {
      setPublishElapsedMs(Date.now() - publishStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [publishStartTime]);

  ensureInitialized();
  const collections = listCollections();
  const current = collections[cursor] ?? null;

  // Detail stats for selected collection
  let entityCount = 0;
  let entityTypeCounts: Array<{ type: string; count: number }> = [];
  let collectionSize = "";
  let lastState: {
    lastSyncStatus: string | null;
    lastSyncAt: string | null;
    lastSyncCreated: number | null;
    lastSyncUpdated: number | null;
    lastSyncDeleted: number | null;
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

        const sync = getCollectionSyncState(dbPath);
        if (sync.lastAt) {
          lastState = {
            lastSyncStatus: sync.lastStatus ?? null,
            lastSyncAt: sync.lastAt,
            lastSyncCreated: sync.lastCreated ?? null,
            lastSyncUpdated: sync.lastUpdated ?? null,
            lastSyncDeleted: sync.lastDeleted ?? null,
          };
          const d = new Date(sync.lastAt + "Z");
          if (!isNaN(d.getTime())) lastSyncTime = formatRelative(d);
        }
      } catch { /* ignore */ }
    }
  }

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

    // Route console.warn into the sync progress display so warnings are visible in the TUI.
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      setSyncProgress((p) => [...p, args.map(String).join(" ")]);
    };

    try {
      if (col.crawler === "remote") {
        await pullCollection(name, {
          onProgress: (msg) => {
            setSyncProgress((p) => [...p, msg]);
          },
        });
        const elapsed = formatElapsed(Date.now() - syncStart);
        setSyncProgress((p) => [...p, `Completed in ${elapsed}`]);
        setMessage(`Sync complete for "${name}"`);
      } else {
      const registry = createDefaultRegistry();
      const themeEngine = new ThemeEngine();
      themeEngine.register(gitHubTheme);
      themeEngine.register(obsidianTheme);
      themeEngine.register(gitTheme);
      themeEngine.register(mantisHubTheme);
      themeEngine.register(rssTheme);
      themeEngine.register(evernoteTheme);
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
        onProgress: (msg: string) => {
          setSyncProgress((p) => [...p, msg]);
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
      }
    } catch (err) {
      setSyncFetchedCounts({});
      setSyncProgress((p) => [...p, `Error: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      console.warn = origWarn;
    }
    setSyncStartTime(null);
    setMode("list");
    refresh();
  }, [current, refresh]);

  const handlePublishPasswordSubmit = useCallback(() => {
    if (editingCollection) {
      startPublish(editingCollection, { password: inputValue.trim() || undefined });
    }
    setInputValue("");
  }, [inputValue, editingCollection, startPublish]);

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
      if (key.escape) { onNavigate?.("home"); return; }
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
      if (input === "p" && current && hasSyncedData(current.name)) {
        setEditingCollection(current.name);
        setMode("publish-menu");
      }
    } else if (mode === "publish-menu") {
      if (key.escape) { setMode("list"); return; }
      if (input === "p" && !current?.publish) {
        setInputValue("");
        setMode("publish-password");
      }
      if (input === "u") {
        setMode("confirm-unpublish");
      }
      if (input === "r" && current?.publish?.protected) {
        startPublish(editingCollection, { removePassword: true });
      }
    } else if (mode === "confirm-unpublish") {
      if (input === "y" && editingCollection) {
        setMode("unpublishing");
        setPublishLog([]);
        setPublishStatus("");
        setPublishLastStep("");
        setPublishError("");
        setPublishStartTime(Date.now());
        let lastStep = "";
        let lastDetail = "";
        const addLogEntry = (entry: string) => {
          setPublishLog((log) => log[log.length - 1] === entry ? log : [...log, entry]);
        };
        unpublishCollection(editingCollection, (step, detail) => {
          if (step !== lastStep && lastStep) {
            addLogEntry(`[${lastStep}] ${lastDetail} ✓`);
          }
          lastStep = step;
          lastDetail = detail;
          setPublishLastStep(step);
          setPublishStatus(detail);
        }).then(() => {
          if (lastStep) addLogEntry(`[${lastStep}] ${lastDetail} ✓`);
          setPublishStatus("");
          setPublishStartTime(null);
          setMessage(`Unpublished "${editingCollection}". Local data preserved.`);
          setMode("publish-done");
          refresh();
        }).catch((err) => {
          setPublishStatus("");
          setPublishStartTime(null);
          setPublishError(err instanceof Error ? err.message : String(err));
          setMode("publish-done");
        });
      } else {
        setMode("publish-menu");
      }
    } else if (mode === "publish-done") {
      if (key.return || key.escape) {
        setPublishLog([]);
        setPublishStatus("");
        setPublishLastStep("");
        setPublishError("");
        setMessage("");
        setMode("list");
      }
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

  if (mode === "publish-menu") {
    const isPublished = !!(current?.publish);
    const isProtected = !!current?.publish?.protected;
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Publishing: {editingCollection}</Text>
        {isPublished && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>URL: {(current!.publish as any).url}</Text>
            <Text dimColor>Status: {isProtected ? "password protected" : "public"}</Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {!isPublished && <Text color="cyan">[p] Publish</Text>}
          <Text>[u] Unpublish</Text>
          <Text color={isPublished && isProtected ? undefined : "gray"}>[r] Remove password{!isPublished ? " (not published)" : !isProtected ? " (already public)" : ""}</Text>
        </Box>
        <Box marginTop={1}><Text dimColor>ESC back</Text></Box>
      </Box>
    );
  }

  if (mode === "publish-password") {
    const existingState = getCollectionPublishState(editingCollection);
    const isProtected = !!existingState?.protected;
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Publish: {editingCollection}</Text>
        <Box marginTop={1} flexDirection="column">
          {existingState ? (
            <>
              <Text dimColor>Currently: {isProtected ? "password protected" : "public (no password)"}</Text>
              <Text dimColor>Leave blank to keep current setting, or enter a new password.</Text>
            </>
          ) : (
            <Text dimColor>Enter a password to protect access, or leave blank for public.</Text>
          )}
          <Box marginTop={1}>
            <TextInput label="Password" value={inputValue} onChange={setInputValue} onSubmit={handlePublishPasswordSubmit} mask />
          </Box>
        </Box>
      </Box>
    );
  }

  if (mode === "confirm-unpublish") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="red">Unpublish "{editingCollection}"?</Text>
        <Text dimColor>This removes the Cloudflare worker, D1 database, and R2 bucket.</Text>
        <Text dimColor>Local collection data is preserved.</Text>
        <Box marginTop={1}><Text>Continue? (y/n)</Text></Box>
      </Box>
    );
  }

  if (mode === "publishing" || mode === "unpublishing") {
    const label = mode === "publishing" ? "Publishing" : "Unpublishing";
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold color="yellow">{label} "{editingCollection}"... ({formatElapsed(publishElapsedMs)})</Text>
        <Box flexDirection="column" marginLeft={1} marginTop={1}>
          {publishLog.map((line: string, i: number) => <Text key={i} dimColor>{line}</Text>)}
          {publishLastStep && <Text color="cyan">[{publishLastStep}] {publishStatus}</Text>}
        </Box>
      </Box>
    );
  }

  if (mode === "publish-done") {
    return (
      <Box flexDirection="column" paddingY={1}>
        {publishError ? (
          <Text color="red" bold>Failed</Text>
        ) : (
          <Text color="green" bold>{message}</Text>
        )}
        <Box flexDirection="column" marginLeft={1} marginTop={1}>
          {publishLog.map((line, i) => <Text key={i} dimColor>{line}</Text>)}
          {publishError && <Text color="red">{publishError}</Text>}
        </Box>
        <Box marginTop={1}><Text dimColor>Press Enter to continue</Text></Box>
      </Box>
    );
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
        <Text bold dimColor>{pad("Published", W_PUBLISHED)}</Text>
        <Text bold dimColor>Last Sync</Text>
      </Box>

      {/* Table rows */}
      <Box flexDirection="column" marginLeft={1}>
        {collections.map((col: { name: string; title?: string; crawler: string; enabled: boolean; publish?: { publishedAt: string } }, i: number) => {
          const stats = getRowStats(col.name);
          const selected = i === cursor;
          const checkbox = col.enabled ? "[x] " : "[ ] ";
          const publishedLabel = col.publish ? formatRelative(new Date(col.publish.publishedAt)) : "—";
          return (
            <Box key={col.name}>
              <Text color={selected ? "cyan" : undefined}>{selected ? "❯ " : "  "}</Text>
              <Text color={col.enabled ? "green" : "gray"}>{pad(checkbox, W_CHECK)}</Text>
              <Text bold={selected} color={!col.enabled ? "gray" : selected ? "cyan" : undefined}>{pad(col.name, W_NAME)}</Text>
              <Text dimColor>{pad(col.title || "", W_TITLE)}</Text>
              <Text dimColor>{pad(col.crawler, W_TYPE)}</Text>
              <Text color={!col.enabled ? "gray" : undefined}>{pad(stats.entityCount, W_ENTITIES)}</Text>
              <Text color={col.publish ? "green" : "gray"}>{pad(publishedLabel, W_PUBLISHED)}</Text>
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
          {lastState ? (
            <Box gap={2}>
              <Text>Last sync: <Text dimColor>{lastSyncTime}</Text> <Text color={lastState.lastSyncStatus === "completed" ? "green" : "red"}>({lastState.lastSyncStatus})</Text></Text>
              <Text><Text color="green">+{lastState.lastSyncCreated ?? 0}</Text> <Text color="yellow">~{lastState.lastSyncUpdated ?? 0}</Text> <Text color="red">-{lastState.lastSyncDeleted ?? 0}</Text></Text>
            </Box>
          ) : (
            <Text dimColor>No sync runs yet</Text>
          )}
          {current.publish && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor bold>Published:</Text>
              <Box gap={1} marginLeft={1}>
                <Text color="blue">{current.publish.url}</Text>
                <Text color={current.publish.protected ? "green" : "yellow"}>
                  [{current.publish.protected ? "protected" : "public"}]
                </Text>
              </Box>
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
        {current && hasSyncedData(current.name) && <Text dimColor>[p] Publishing</Text>}
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
