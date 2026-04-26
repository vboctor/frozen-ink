/**
 * Management API endpoints for the desktop app (and local server in desktop mode).
 * These routes handle collection CRUD, sync triggering, publish orchestration,
 * export, and configuration — all gated behind mode === "desktop".
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import {
  getFrozenInkHome,
  getCollectionDb,
  listCollections,
  getCollection,
  getCollectionDbPath,
  addCollection,
  removeCollection,
  updateCollection,
  renameCollection,
  clearCollectionPublishState,
  getCollectionPublishState,
  loadConfig,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
  entities,
  resolveCredentials,
  listNamedCredentials,
  getNamedCredentials,
  getCollectionSyncState,
  updateCollectionSyncState,
} from "@frozenink/core";
import {
  createDefaultRegistry,
  MantisHubCrawler,
  gitHubTheme,
  obsidianTheme,
  gitTheme,
  mantisHubTheme,
  rssTheme,
} from "@frozenink/crawlers";
import { prepareCollection } from "./prepare";
import { createGenerateThemeEngine } from "./generate";
import { pullCollection } from "./pull";

// --- In-memory sync/publish/export progress tracking ---

/**
 * Legacy shape retained for the /api/sync/status endpoint. Derived from the
 * per-collection jobs map so existing consumers keep working while the new
 * /api/sync/jobs endpoint exposes the full list for parallel tracking.
 */
export interface SyncProgress {
  active: boolean;
  collectionName: string | null;
  status: string;
  created: number;
  updated: number;
  deleted: number;
  error: string | null;
}

export interface SyncJob {
  collectionName: string;
  active: boolean;
  status: string;
  created: number;
  updated: number;
  deleted: number;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  full: boolean;
}

export interface PublishProgress {
  active: boolean;
  step: string;
  detail: string;
  error: string | null;
  /** Unix timestamp in ms when the publish run started, for elapsed-time display. */
  startedAt: number | null;
}

export interface ExportProgress {
  active: boolean;
  step: string;
  current: number;
  total: number;
  error: string | null;
}

const syncJobs = new Map<string, SyncJob>();
/** Keep finished jobs around briefly so the UI can render their final state. */
const JOB_RETENTION_MS = 60_000;

function pruneJobs(): void {
  const now = Date.now();
  for (const [name, job] of syncJobs) {
    if (!job.active && job.completedAt && now - job.completedAt > JOB_RETENTION_MS) {
      syncJobs.delete(name);
    }
  }
}

function listSyncJobs(): SyncJob[] {
  pruneJobs();
  return [...syncJobs.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** Derive the legacy singleton shape from the jobs map. */
function derivedSyncProgress(): SyncProgress {
  const jobs = listSyncJobs();
  const active = jobs.filter((j) => j.active);
  if (active.length > 0) {
    // Aggregate counts across all active jobs so "Sync All" sees totals.
    const totals = active.reduce(
      (acc, j) => ({
        created: acc.created + j.created,
        updated: acc.updated + j.updated,
        deleted: acc.deleted + j.deleted,
      }),
      { created: 0, updated: 0, deleted: 0 },
    );
    const primary = active[active.length - 1];
    return {
      active: true,
      collectionName: active.length === 1 ? primary.collectionName : null,
      status: active.length === 1 ? primary.status : `syncing ${active.length} collections`,
      created: totals.created,
      updated: totals.updated,
      deleted: totals.deleted,
      error: null,
    };
  }
  // No active jobs — surface the most recently completed as the "last result".
  if (jobs.length === 0) {
    return { active: false, collectionName: null, status: "idle", created: 0, updated: 0, deleted: 0, error: null };
  }
  const last = jobs.reduce((a, b) => ((b.completedAt ?? 0) > (a.completedAt ?? 0) ? b : a));
  return {
    active: false,
    collectionName: last.collectionName,
    status: last.error ? "failed" : "completed",
    created: last.created,
    updated: last.updated,
    deleted: last.deleted,
    error: last.error,
  };
}

let publishProgress: PublishProgress = {
  active: false,
  step: "idle",
  detail: "",
  error: null,
  startedAt: null,
};

let exportProgress: ExportProgress = {
  active: false,
  step: "idle",
  current: 0,
  total: 0,
  error: null,
};

type PublishCollectionsFn = (
  options: {
    collectionName: string;
    toolDescription?: string;
    password?: string;
    removePassword?: boolean;
    forcePublic?: boolean;
  },
  onProgress: (step: string, detail: string) => void,
) => Promise<unknown>;

let publishCollectionsOverride: PublishCollectionsFn | null = null;

export function setPublishCollectionsOverride(fn: PublishCollectionsFn | null): void {
  publishCollectionsOverride = fn;
}

// --- Helpers ---

/** Recursively sum file sizes in a directory. */
function getDirectorySize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySize(fullPath);
      } else {
        try { total += statSync(fullPath).size; } catch {}
      }
    }
  } catch {}
  return total;
}

/** Get disk size in bytes for a collection (db + content). */
function getCollectionDiskSize(name: string): number {
  const home = getFrozenInkHome();
  const colDir = join(home, "collections", name);
  return getDirectorySize(colDir);
}

// --- Mode detection ---
let appMode: "desktop" | "local" | "published" = "local";

export function setAppMode(mode: "desktop" | "local" | "published") {
  appMode = mode;
}

// --- Theme engine ---
function createThemeEngine(): ThemeEngine {
  const engine = new ThemeEngine();
  engine.register(gitHubTheme);
  engine.register(obsidianTheme);
  engine.register(gitTheme);
  engine.register(mantisHubTheme);
  engine.register(rssTheme);
  return engine;
}

// --- JSON helpers ---
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// --- Route handler ---

/**
 * Attempt to handle a management API request.
 * Returns a Response if matched, null otherwise (so the caller can fall through).
 */
export function handleManagementRequest(req: Request): Response | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/app-info
  if (path === "/api/app-info" && method === "GET") {
    return jsonResponse({
      mode: appMode,
      version: "0.1.0",
      workspacePath: getFrozenInkHome(),
    });
  }

  // --- Credentials CRUD ---

  // GET /api/credentials — list named credential sets (names + keys only)
  if (path === "/api/credentials" && method === "GET") {
    const names = listNamedCredentials();
    const items = names.map((name) => {
      const creds = getNamedCredentials(name)!;
      return { name, keys: Object.keys(creds) };
    });
    return jsonResponse(items);
  }

  // --- Collection CRUD ---

  // POST /api/collections (add collection)
  if (path === "/api/collections" && method === "POST") {
    return handleAsync(async () => {
      const body = await readBody(req);
      const name = body.name as string;
      const crawler = body.crawler as string;
      if (!name || !crawler) return errorResponse("Missing name or crawler", 400);
      const config = (body.config ?? {}) as Record<string, unknown>;
      const credentials = (body.credentials ?? {}) as string | Record<string, unknown>;
      const title = (body.title as string) ?? name;
      const description = (body.description as string) || undefined;
      const enabled = body.enabled !== false;

      // Resolve MantisHub project name → ID and persist both
      if (crawler === "mantishub" && config.projectName && !config.projectId) {
        try {
          const registry = createDefaultRegistry();
          const crawlerInstance = registry.get("mantishub")!() as MantisHubCrawler;
          await crawlerInstance.initialize(config, resolveCredentials(credentials));
          const resolved = await crawlerInstance.resolveProjectName(config.projectName as string);
          config.projectId = resolved.id;
          config.projectName = resolved.name;
        } catch {
          // Resolution failed — save with just projectName; will resolve at sync time
        }
      }

      addCollection(name, { title, description, crawler, enabled, config, credentials });

      // Ensure collection directory exists
      const home = getFrozenInkHome();
      const colDir = join(home, "collections", name);
      mkdirSync(join(colDir, "markdown"), { recursive: true });

      return jsonResponse({ ok: true, name });
    });
  }

  // DELETE /api/collections/:name
  const deleteColMatch = path.match(/^\/api\/collections\/([^/]+)$/);
  if (deleteColMatch && method === "DELETE") {
    return handleAsync(async () => {
      const name = decodeURIComponent(deleteColMatch[1]);
      const col = getCollection(name);
      if (!col) return errorResponse("Collection not found", 404);
      const body = await readBody(req);
      const confirmName = typeof body.confirmName === "string" ? body.confirmName : "";
      if (confirmName !== name) {
        return errorResponse(`Confirmation failed. Type exactly "${name}" to delete this collection.`, 400);
      }
      removeCollection(name);
      return jsonResponse({ ok: true });
    });
  }

  // PATCH /api/collections/:name
  const patchColMatch = path.match(/^\/api\/collections\/([^/]+)$/);
  if (patchColMatch && method === "PATCH") {
    return handleAsync(async () => {
      const name = decodeURIComponent(patchColMatch[1]);
      const col = getCollection(name);
      if (!col) return errorResponse("Collection not found", 404);
      const body = await readBody(req);
      updateCollection(name, body as any);
      // Re-run prepare so AGENTS.md/CLAUDE.md and folder configs stay up to date
      const updatedCol = getCollection(name);
      if (updatedCol) {
        const home = getFrozenInkHome();
        const themeEngine = createGenerateThemeEngine();
        await prepareCollection(updatedCol, home, themeEngine, (msg) => console.log(`[prepare:${name}]`, msg));
      }
      return jsonResponse({ ok: true });
    });
  }

  // GET /api/collections/:name/config — returns full collection YAML config for editing
  const getConfigMatch = path.match(/^\/api\/collections\/([^/]+)\/config$/);
  if (getConfigMatch && method === "GET") {
    const name = decodeURIComponent(getConfigMatch[1]);
    const col = getCollection(name);
    if (!col) return errorResponse("Collection not found", 404);
    // Return the full config including credentials key (string name or inline object)
    return jsonResponse({
      title: col.title,
      description: col.description,
      crawler: col.crawler,
      enabled: col.enabled,
      config: col.config ?? {},
      credentials: col.credentials ?? {},
    });
  }

  // POST /api/collections/:name/prepare
  const prepareColMatch = path.match(/^\/api\/collections\/([^/]+)\/prepare$/);
  if (prepareColMatch && method === "POST") {
    return handleAsync(async () => {
      const name = decodeURIComponent(prepareColMatch[1]);
      const col = getCollection(name);
      if (!col) return errorResponse("Collection not found", 404);
      const home = getFrozenInkHome();
      const themeEngine = createGenerateThemeEngine();
      await prepareCollection(col, home, themeEngine, (msg) => console.log(`[prepare:${name}]`, msg));
      return jsonResponse({ ok: true });
    });
  }

  // POST /api/collections/:name/rename
  const renameMatch = path.match(/^\/api\/collections\/([^/]+)\/rename$/);
  if (renameMatch && method === "POST") {
    return handleAsync(async () => {
      const oldName = decodeURIComponent(renameMatch[1]);
      const body = await readBody(req);
      const newName = body.newName as string;
      if (!newName) return errorResponse("Missing newName", 400);
      const col = getCollection(oldName);
      if (!col) return errorResponse("Collection not found", 404);
      renameCollection(oldName, newName);
      return jsonResponse({ ok: true });
    });
  }

  // GET /api/collections/:name/status
  const statusMatch = path.match(/^\/api\/collections\/([^/]+)\/status$/);
  if (statusMatch && method === "GET") {
    const name = decodeURIComponent(statusMatch[1]);
    const col = getCollection(name);
    if (!col) return errorResponse("Collection not found", 404);

    const dbPath = getCollectionDbPath(name);
    let entityCount = 0;
    if (existsSync(dbPath)) {
      const colDb = getCollectionDb(dbPath);
      entityCount = colDb.select().from(entities).all().length;
    }

    const diskSizeBytes = getCollectionDiskSize(name);
    const sync = getCollectionSyncState(dbPath);
    return jsonResponse({
      entityCount,
      diskSizeBytes,
      lastSyncRun: sync.lastAt ? {
        status: sync.lastStatus,
        startedAt: sync.lastAt,
        entitiesCreated: sync.lastCreated ?? 0,
        entitiesUpdated: sync.lastUpdated ?? 0,
        entitiesDeleted: sync.lastDeleted ?? 0,
        errors: sync.lastErrors ?? null,
      } : null,
    });
  }

  // --- Sync ---

  // POST /api/sync/:name (sync single collection — fire-and-forget)
  const syncOneMatch = path.match(/^\/api\/sync\/([^/]+)$/);
  if (syncOneMatch && method === "POST") {
    const name = decodeURIComponent(syncOneMatch[1]);
    // Seed an "active" job synchronously so status polls between the HTTP
    // response and the actual sync start don't see an idle state.
    ensureSyncJob(name, false);
    return handleAsync(async () => {
      const body = await readBody(req);
      const full = !!body.full;
      void startSyncJob(name, full);
      return jsonResponse({ ok: true });
    });
  }

  // POST /api/sync (sync all enabled collections — in parallel)
  if (path === "/api/sync" && method === "POST") {
    const enabled = listCollections().filter((c) => c.enabled);
    for (const c of enabled) ensureSyncJob(c.name, false);
    return handleAsync(async () => {
      const body = await readBody(req);
      const full = !!body.full;
      for (const c of enabled) void startSyncJob(c.name, full);
      return jsonResponse({ ok: true, started: enabled.map((c) => c.name) });
    });
  }

  // GET /api/sync/status — legacy aggregate view (derived from the jobs map)
  if (path === "/api/sync/status" && method === "GET") {
    return jsonResponse(derivedSyncProgress());
  }

  // GET /api/sync/jobs — list all active + recently completed sync jobs
  if (path === "/api/sync/jobs" && method === "GET") {
    return jsonResponse(listSyncJobs());
  }

  // GET /api/collections/:name/sync-runs (returns last sync state wrapped in an array for backward compat)
  const syncRunsMatch = path.match(/^\/api\/collections\/([^/]+)\/sync-runs$/);
  if (syncRunsMatch && method === "GET") {
    const name = decodeURIComponent(syncRunsMatch[1]);
    const col = getCollection(name);
    if (!col) return jsonResponse([]);
    const sync = getCollectionSyncState(getCollectionDbPath(name));
    if (!sync.lastAt) return jsonResponse([]);
    return jsonResponse([{
      status: sync.lastStatus,
      startedAt: sync.lastAt,
      entitiesCreated: sync.lastCreated ?? 0,
      entitiesUpdated: sync.lastUpdated ?? 0,
      entitiesDeleted: sync.lastDeleted ?? 0,
      errors: sync.lastErrors ?? null,
    }]);
  }

  // --- Collection Publish ---

  // POST /api/collections/:name/unpublish — full Cloudflare teardown
  const unpublishColMatch = path.match(/^\/api\/collections\/([^/]+)\/unpublish$/);
  if (unpublishColMatch && method === "POST") {
    const name = decodeURIComponent(unpublishColMatch[1]);
    return handleAsync(async () => {
      // Fire-and-forget so the UI can poll /api/publish/status (which is
      // shared between publish and unpublish — only one runs at a time).
      publishProgress = { active: true, step: "starting", detail: `Unpublishing "${name}"...`, error: null, startedAt: Date.now() };
      void (async () => {
        const startedAt = publishProgress.startedAt ?? Date.now();
        try {
          const { unpublishCollection } = await import("./unpublish");
          await unpublishCollection(name, (step, detail) => {
            console.log(`  [unpublish:${step}] ${detail}`);
            publishProgress = { ...publishProgress, step, detail };
          });
          publishProgress = { active: false, step: "done", detail: `Unpublished "${name}"`, error: null, startedAt };
        } catch (err) {
          publishProgress = { active: false, step: "failed", detail: "", error: String(err), startedAt };
        }
      })();
      return jsonResponse({ ok: true });
    });
  }

  // --- Export ---

  // POST /api/export
  if (path === "/api/export" && method === "POST") {
    return handleAsync(async () => {
      const body = await readBody(req);
      const collections = body.collections as string[];
      const outputDir = body.outputDir as string;
      const format = (body.format as string) ?? "markdown";
      if (!collections?.length || !outputDir) {
        return errorResponse("Missing collections or outputDir", 400);
      }

      // Dynamic import to avoid circular deps
      const { exportStaticSite } = await import("@frozenink/core/export");
      exportProgress = { active: true, step: "starting", current: 0, total: 0, error: null };
      try {
        await exportStaticSite({
          collections,
          outputDir,
          format: format as "markdown" | "html",
          onProgress: (step, current, total) => {
            exportProgress = { ...exportProgress, step, current, total };
          },
        });
        exportProgress = { ...exportProgress, active: false, step: "done" };
      } catch (err) {
        exportProgress = { ...exportProgress, active: false, error: String(err) };
      }
      return jsonResponse({ ok: true });
    });
  }

  // GET /api/export/status
  if (path === "/api/export/status" && method === "GET") {
    return jsonResponse(exportProgress);
  }

  // --- Config ---

  // GET /api/config
  if (path === "/api/config" && method === "GET") {
    const config = loadConfig();
    return jsonResponse(config);
  }

  // PATCH /api/config
  if (path === "/api/config" && method === "PATCH") {
    return handleAsync(async () => {
      const body = await readBody(req);
      const home = getFrozenInkHome();
      const configPath = join(home, "frozenink.yml");

      let existing: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        existing = (yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>) ?? {};
      }

      const merged = { ...existing, ...body };
      writeFileSync(configPath, yaml.dump(merged, { lineWidth: -1, noRefs: true, sortKeys: false }), "utf-8");
      return jsonResponse({ ok: true });
    });
  }

  // --- UI Preferences (stored in frozenink.yml so they survive port changes) ---

  // GET /api/preferences
  if (path === "/api/preferences" && method === "GET") {
    const home = getFrozenInkHome();
    const configPath = join(home, "frozenink.yml");
    let prefs: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        const raw = (yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>) ?? {};
        prefs = (raw.ui_preferences as Record<string, unknown>) ?? {};
      } catch {}
    }
    return jsonResponse(prefs);
  }

  // PATCH /api/preferences
  if (path === "/api/preferences" && method === "PATCH") {
    return handleAsync(async () => {
      const body = await readBody(req);
      const home = getFrozenInkHome();
      const configPath = join(home, "frozenink.yml");

      let existing: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try { existing = (yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>) ?? {}; } catch {}
      }
      existing.ui_preferences = { ...((existing.ui_preferences as Record<string, unknown>) ?? {}), ...body };
      writeFileSync(configPath, yaml.dump(existing, { lineWidth: -1, noRefs: true, sortKeys: false }), "utf-8");
      return jsonResponse({ ok: true });
    });
  }

  // --- Cloudflare auth check ---

  // POST /api/cloudflare/check-auth
  if (path === "/api/cloudflare/check-auth" && method === "POST") {
    return handleAsync(async () => {
      try {
        const { checkWranglerAuth } = await import("./wrangler-api");
        await checkWranglerAuth();
        return jsonResponse({ authenticated: true });
      } catch (err) {
        return jsonResponse({ authenticated: false, error: String(err) });
      }
    });
  }

  // --- MCP tool links ---

  if (path === "/api/mcp/status" && method === "GET") {
    return handleAsync(async () => {
      const { listMcpConnections } = await import("../mcp/manager");
      const statuses = await listMcpConnections();
      return jsonResponse(statuses);
    });
  }

  if (path === "/api/mcp/add" && method === "POST") {
    return handleAsync(async () => {
      const body = await readBody(req);
      const tool = body.tool as string | undefined;
      const collections = body.collections as string[] | undefined;
      if (!tool || !collections?.length) {
        return errorResponse("Missing tool or collections", 400);
      }
      const transport = (body.transport as string | undefined) === "http" ? "http" : "stdio";
      const password = body.password as string | undefined;
      const description = body.description as string | undefined;
      try {
        const { addMcpConnections } = await import("../mcp/manager");
        const { normalizeMcpToolName, isMcpToolName } = await import("../mcp/tools");
        if (!isMcpToolName(tool)) return errorResponse(`Unsupported tool "${tool}"`, 400);
        const results = await addMcpConnections({
          tool: normalizeMcpToolName(tool),
          collections,
          description,
          transport,
          password,
        });
        return jsonResponse({ ok: true, results });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400);
      }
    });
  }

  if (path === "/api/mcp/remove" && method === "POST") {
    return handleAsync(async () => {
      const body = await readBody(req);
      const tool = body.tool as string | undefined;
      const collections = body.collections as string[] | undefined;
      if (!tool || !collections?.length) {
        return errorResponse("Missing tool or collections", 400);
      }
      try {
        const { removeMcpConnections } = await import("../mcp/manager");
        const { normalizeMcpToolName, isMcpToolName } = await import("../mcp/tools");
        if (!isMcpToolName(tool)) return errorResponse(`Unsupported tool "${tool}"`, 400);
        const results = await removeMcpConnections({
          tool: normalizeMcpToolName(tool),
          collections,
        });
        return jsonResponse({ ok: true, results });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400);
      }
    });
  }

  // --- Publish ---

  // POST /api/collections/:name/publish
  const publishColMatch = path.match(/^\/api\/collections\/([^/]+)\/publish$/);
  if (publishColMatch && method === "POST") {
    return handleAsync(async () => {
      const name = decodeURIComponent(publishColMatch[1]);
      const body = await readBody(req);
      publishProgress = { active: true, step: "starting", detail: "", error: null, startedAt: Date.now() };
      // Fire and forget — the UI polls /api/publish/status
      triggerPublish({ ...body, collectionName: name }).catch(() => {});
      return jsonResponse({ ok: true });
    });
  }

  // GET /api/publish/status
  if (path === "/api/publish/status" && method === "GET") {
    return jsonResponse(publishProgress);
  }

  return null;
}

// --- Async handler wrapper ---
// Both Bun.serve and our Node http adapter support Promise<Response>.
function handleAsync(fn: () => Promise<Response>): Response {
  return fn() as any;
}

// --- Sync logic ---

/**
 * Ensure a job slot exists for `name`, seeded in an active/starting state.
 * Returns null if a sync is already running for this collection (caller
 * should not start another).
 */
function ensureSyncJob(name: string, full: boolean): SyncJob | null {
  const existing = syncJobs.get(name);
  if (existing && existing.active) return null;
  const job: SyncJob = {
    collectionName: name,
    active: true,
    status: "starting",
    created: 0,
    updated: 0,
    deleted: 0,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
    full,
  };
  syncJobs.set(name, job);
  return job;
}

/**
 * Serialize post-sync republishes so concurrent sync completions don't
 * clobber each other's Cloudflare deploys (and the shared publishProgress).
 */
let publishChain: Promise<unknown> = Promise.resolve();
function queuePublish(fn: () => Promise<void>): Promise<void> {
  const next = publishChain.then(fn, fn);
  publishChain = next.catch(() => {});
  return next;
}

/**
 * Run a sync for a single collection as a background task. Safe to call
 * multiple times in parallel with different collection names.
 */
async function startSyncJob(name: string, full: boolean): Promise<void> {
  const job = ensureSyncJob(name, full);
  if (!job) return; // already running
  job.full = full;

  const home = getFrozenInkHome();
  const registry = createDefaultRegistry();
  const themeEngine = createThemeEngine();
  const prepareThemeEngine = createGenerateThemeEngine();

  try {
    const col = getCollection(name);
    if (!col) throw new Error(`Collection "${name}" not found`);

    // Remote/cloned collections use pullCollection — no prepare or crawler needed
    if (col.crawler === "remote") {
      job.status = `syncing ${name}`;
      console.log(`[sync:${name}] starting (remote/cloned)`);
      const result = await pullCollection(name, {
        onProgress: (msg) => {
          job.status = msg;
          console.log(`[sync:${name}] ${msg}`);
        },
      });
      job.created = result.created;
      job.updated = result.updated;
      job.deleted = result.deleted;
    } else {
      // Run prepare before incremental sync: schema migrations, folder ymls, stale markdown check
      if (!full) {
        job.status = `preparing ${name}`;
        await prepareCollection(col, home, prepareThemeEngine, (msg) => console.log(`[prepare:${name}]`, msg));
      }

      job.status = `syncing ${name}`;

      const factory = registry.get(col.crawler);
      if (!factory) throw new Error(`No crawler registered for "${col.crawler}"`);

      const crawler = factory();
      try {
        const credRef = typeof col.credentials === "string"
          ? `name:"${col.credentials}" (from ${join(home, "credentials.yml")})`
          : `inline(${Object.keys(col.credentials).join(",")})`;
        console.log(`[sync] "${name}" (${col.crawler}) credentials=${credRef}`);
        await crawler.initialize(
          col.config as Record<string, unknown>,
          resolveCredentials(col.credentials),
        );

        const collectionDir = join(home, "collections", name);
        mkdirSync(join(collectionDir, "content"), { recursive: true });
        const storage = new LocalStorageBackend(collectionDir);

        if (full) {
          const contentDir = join(collectionDir, "content");
          const dbDir = join(collectionDir, "db");
          if (existsSync(contentDir)) rmSync(contentDir, { recursive: true, force: true });
          if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true });
          mkdirSync(join(collectionDir, "content"), { recursive: true });
          updateCollectionSyncState(getCollectionDbPath(name), { cursor: null });
          job.status = `${name}: cleared local data for full re-sync`;
        }

        const engine = new SyncEngine({
          crawler,
          dbPath: getCollectionDbPath(name),
          collectionName: name,
          themeEngine,
          storage,
          markdownBasePath: "content",
          assetConfig: col.assets as { extensions?: string[]; maxSize?: number } | undefined,
          onEntityProcessed: (info) => {
            if (info.created) job.created++;
            if (info.updated) job.updated++;
          },
          onProgress: (msg) => {
            job.status = `${name}: ${msg}`;
            console.log(`[sync:${name}] ${msg}`);
          },
        });

        const result = await engine.run({ syncType: full ? "full" : "incremental" });
        job.deleted = result.deleted;
        console.log(`[sync:${name}] done: +${result.created} ~${result.updated} -${result.deleted}`);
      } finally {
        await crawler.dispose();
      }
    }

    // Post-sync republish (serialized across collections via queuePublish)
    if (getCollectionPublishState(name)) {
      console.log(`[sync:${name}] collection is published — queueing republish`);
      job.status = `waiting to republish ${name}`;
      await queuePublish(async () => {
        job.status = `republishing ${name}: starting`;
        try {
          await triggerPublish({ collectionName: name }, (step, detail) => {
            const label = detail || step;
            job.status = `republishing ${name}: ${label}`;
          });
        } catch (err) {
          console.error(`[sync:${name}] republish failed: ${err}`);
          job.status = `republish failed: ${String(err)}`;
        }
      });
    }

    job.status = "completed";
  } catch (err) {
    job.error = String(err);
    job.status = "failed";
    console.error(`[sync:${name}] failed: ${err}`);
  } finally {
    job.active = false;
    job.completedAt = Date.now();
  }
}

// --- Publish logic ---

async function triggerPublish(
  opts: Record<string, unknown>,
  onExtraProgress?: (step: string, detail: string) => void,
): Promise<void> {
  const startedAt = publishProgress.startedAt ?? Date.now();
  publishProgress = { active: true, step: "starting", detail: "Starting publish...", error: null, startedAt };
  try {
    const publishCollections = publishCollectionsOverride
      ?? (await import("./publish")).publishCollections;
    const collectionName = (opts.collectionName as string) ?? "";
    const toolDescription = opts.toolDescription as string | undefined;
    const password = opts.password as string | undefined;
    const removePassword = opts.removePassword as boolean | undefined;
    const forcePublic = opts.forcePublic as boolean | undefined;

    await publishCollections(
      { collectionName, toolDescription, password, removePassword, forcePublic },
      (step, detail) => {
        publishProgress = { ...publishProgress, step, detail };
        console.log(`[publish:${collectionName}] ${step}: ${detail}`);
        onExtraProgress?.(step, detail);
      },
    );

    publishProgress = { active: false, step: "done", detail: "Publish completed", error: null, startedAt };
  } catch (err) {
    publishProgress = { active: false, step: "failed", detail: "", error: String(err), startedAt };
    throw err;
  }
}
