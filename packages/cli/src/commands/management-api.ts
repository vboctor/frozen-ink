/**
 * Management API endpoints for the desktop app (and local server in desktop mode).
 * These routes handle collection CRUD, sync triggering, publish orchestration,
 * export, and configuration — all gated behind mode === "desktop".
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
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
} from "@frozenink/crawlers";
import { prepareCollection } from "./prepare";
import { createGenerateThemeEngine } from "./generate";

// --- In-memory sync/publish/export progress tracking ---

export interface SyncProgress {
  active: boolean;
  collectionName: string | null;
  status: string;
  created: number;
  updated: number;
  deleted: number;
  error: string | null;
}

export interface PublishProgress {
  active: boolean;
  step: string;
  detail: string;
  error: string | null;
}

export interface ExportProgress {
  active: boolean;
  step: string;
  current: number;
  total: number;
  error: string | null;
}

let syncProgress: SyncProgress = {
  active: false,
  collectionName: null,
  status: "idle",
  created: 0,
  updated: 0,
  deleted: 0,
  error: null,
};

let publishProgress: PublishProgress = {
  active: false,
  step: "idle",
  detail: "",
  error: null,
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
    const name = decodeURIComponent(deleteColMatch[1]);
    const col = getCollection(name);
    if (!col) return errorResponse("Collection not found", 404);
    removeCollection(name);
    return jsonResponse({ ok: true });
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

    const sync = getCollectionSyncState(dbPath);
    return jsonResponse({
      entityCount,
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

  // POST /api/sync/:name (sync single collection)
  const syncOneMatch = path.match(/^\/api\/sync\/([^/]+)$/);
  if (syncOneMatch && method === "POST") {
    const name = decodeURIComponent(syncOneMatch[1]);
    return handleAsync(async () => {
      const body = await readBody(req);
      const full = !!body.full;
      await triggerSync([name], full);
      return jsonResponse({ ok: true });
    });
  }

  // POST /api/sync (sync all)
  if (path === "/api/sync" && method === "POST") {
    return handleAsync(async () => {
      const body = await readBody(req);
      const full = !!body.full;
      const collections = listCollections().filter((c) => c.enabled);
      const names = collections.map((c) => c.name);
      await triggerSync(names, full);
      return jsonResponse({ ok: true });
    });
  }

  // GET /api/sync/status
  if (path === "/api/sync/status" && method === "GET") {
    return jsonResponse(syncProgress);
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
      const { unpublishCollection } = await import("./unpublish");
      await unpublishCollection(name, (step, detail) => {
        console.log(`  [unpublish:${step}] ${detail}`);
      });
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

  // --- Publish ---

  // POST /api/collections/:name/publish
  const publishColMatch = path.match(/^\/api\/collections\/([^/]+)\/publish$/);
  if (publishColMatch && method === "POST") {
    return handleAsync(async () => {
      const name = decodeURIComponent(publishColMatch[1]);
      const body = await readBody(req);
      publishProgress = { active: true, step: "starting", detail: "", error: null };
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

async function triggerSync(collectionNames: string[], full: boolean): Promise<void> {
  const home = getFrozenInkHome();
  const registry = createDefaultRegistry();
  const themeEngine = createThemeEngine();
  const prepareThemeEngine = createGenerateThemeEngine();

  syncProgress = {
    active: true,
    collectionName: null,
    status: "starting",
    created: 0,
    updated: 0,
    deleted: 0,
    error: null,
  };

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;

  try {
    for (const name of collectionNames) {
      const col = getCollection(name);
      if (!col) continue;

      // Run prepare before incremental sync: schema migrations, folder ymls, stale markdown check
      if (!full) {
        syncProgress = { ...syncProgress, collectionName: name, status: `preparing ${name}` };
        await prepareCollection(col, home, prepareThemeEngine, (msg) => console.log(`[prepare:${name}]`, msg));
      }

      syncProgress = {
        ...syncProgress,
        collectionName: name,
        status: `syncing ${name}`,
      };

      const factory = registry.get(col.crawler);
      if (!factory) continue;

      const crawler = factory();
      try {
        await crawler.initialize(
          col.config as Record<string, unknown>,
          resolveCredentials(col.credentials),
        );

        const collectionDir = join(home, "collections", name);
        mkdirSync(join(collectionDir, "content"), { recursive: true });
        const storage = new LocalStorageBackend(collectionDir);

        // If full sync requested, clear the incremental cursor from the DB
        if (full) {
          updateCollectionSyncState(getCollectionDbPath(name), { cursor: null });
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
            if (info.created) totalCreated++;
            if (info.updated) totalUpdated++;
            syncProgress = {
              ...syncProgress,
              created: totalCreated,
              updated: totalUpdated,
            };
          },
        });

        const result = await engine.run({ syncType: full ? "full" : "incremental" });
        totalDeleted += result.deleted;
        syncProgress = { ...syncProgress, deleted: totalDeleted };
      } finally {
        await crawler.dispose();
      }
    }

    syncProgress = {
      active: false,
      collectionName: null,
      status: "completed",
      created: totalCreated,
      updated: totalUpdated,
      deleted: totalDeleted,
      error: null,
    };
  } catch (err) {
    syncProgress = {
      ...syncProgress,
      active: false,
      status: "failed",
      error: String(err),
    };
  }
}

// --- Publish logic ---

async function triggerPublish(opts: Record<string, unknown>): Promise<void> {
  publishProgress = { active: true, step: "starting", detail: "Starting publish...", error: null };
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
      },
    );

    publishProgress = { active: false, step: "done", detail: "Publish completed", error: null };
  } catch (err) {
    publishProgress = { active: false, step: "failed", detail: "", error: String(err) };
  }
}
