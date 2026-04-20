import { Command } from "commander";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, extname, basename } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  listCollections,
  getCollection,
  getCollectionDbPath,
  entities,
  SearchIndexer,
  ThemeEngine,
  MetadataStore,
  loadConfig,
  getModuleDir,
  isBun,
  resolveUiDist,
  entityMarkdownPath,
  splitMarkdownPath,
  type EntityData,
  type FolderConfig,
} from "@frozenink/core";
import {
  gitHubTheme,
  obsidianTheme,
  gitTheme,
  mantisHubTheme,
  rssTheme,
} from "@frozenink/crawlers";
import { startStdioServer } from "@frozenink/mcp";
import { eq, desc, inArray, and } from "drizzle-orm";
import { handleManagementRequest, setAppMode } from "./management-api";
import { prepareCollections } from "./prepare";

const __moduleDir = getModuleDir(import.meta.url);

function createThemeEngine(): ThemeEngine {
  const themeEngine = new ThemeEngine();
  themeEngine.register(gitHubTheme);
  themeEngine.register(obsidianTheme);
  themeEngine.register(gitTheme);
  themeEngine.register(mantisHubTheme);
  themeEngine.register(rssTheme);
  return themeEngine;
}

/**
 * For cloned ("remote") collections, resolve the original crawler type stored
 * in the DB metadata at clone time so that theme rendering and folder configs
 * work correctly.
 */
function effectiveCrawlerType(col: ReturnType<typeof getCollection>, dbPath: string): string {
  if (col!.crawler === "remote" && existsSync(dbPath)) {
    try {
      const meta = new MetadataStore(dbPath);
      const orig = meta.getCrawlerType();
      meta.close();
      if (orig) return orig;
    } catch { /* fall through */ }
  }
  return col!.crawler;
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".php": "text/plain",
  ".csv": "text/plain",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".ico": "image/x-icon",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/** Returns true if `filename` matches any of the glob patterns. */
function matchesHidePattern(patterns: string[], filename: string): boolean {
  return patterns.some((pattern) => {
    // Escape regex special chars except * and ?, then convert glob wildcards
    const re = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
    );
    return re.test(filename);
  });
}

/** Parse a folder yml file (visible/sort/hide/showCount fields). */
function readFolderConfig(dirPath: string): { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[]; showCount?: boolean } {
  const folderName = basename(dirPath);
  const ymlPath = join(dirPath, `${folderName}.yml`);
  if (!existsSync(ymlPath)) return {};
  try {
    const content = readFileSync(ymlPath, "utf-8");
    const config: { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[]; showCount?: boolean } = {};
    for (const line of content.split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (key === "visible") config.visible = val.trim() !== "false";
      if (key === "sort") config.sort = val.trim() === "DESC" ? "DESC" : "ASC";
      if (key === "showCount") config.showCount = val.trim() === "true";
      if (key === "hide") {
        // Parse inline YAML array: [item1, item2] or ["item1", "item2"]
        const arrayMatch = val.trim().match(/^\[(.+)\]$/);
        if (arrayMatch) {
          config.hide = arrayMatch[1]
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        }
      }
    }
    return config;
  } catch {
    return {};
  }
}

/**
 * Pool of open SearchIndexer handles keyed by DB path. Opening a SQLite
 * connection + running PRAGMA + CREATE TABLE IF NOT EXISTS on every
 * keystroke during search-as-you-type adds measurable latency; caching the
 * handle across requests avoids it.
 *
 * When a collection is full-synced its DB file is deleted and recreated. The
 * cached handle would then point at the unlinked inode and miss subsequent
 * writes, so we check the file's inode on each lookup and reopen if it
 * changed. One stat per search request is cheap.
 */
const searchIndexerCache = new Map<string, { indexer: SearchIndexer; ino: number }>();

function getCachedSearchIndexer(dbPath: string): SearchIndexer {
  const ino = statSync(dbPath).ino;
  const cached = searchIndexerCache.get(dbPath);
  if (cached && cached.ino === ino) return cached.indexer;
  // Inode changed (file replaced) or no cached handle — open a fresh one.
  try { cached?.indexer.close(); } catch { /* already closed */ }
  const indexer = new SearchIndexer(dbPath);
  searchIndexerCache.set(dbPath, { indexer, ino });
  return indexer;
}

/**
 * Pick the first file in the visible tree order: subdirectories are visited
 * before files at every level, subdirectories are sorted ASC by name, and the
 * leaf folder's `sort` config (ASC/DESC) decides file order within it. This
 * mirrors what `buildFileTree` renders so the default-open file matches what
 * the user sees in the sidebar.
 */
function pickFirstTreeFile(
  rows: Array<{ folder: string; slug: string }>,
  folderConfigs: Record<string, FolderConfig>,
): { folder: string; slug: string } | null {
  // Group entity slugs by folder path
  const filesByFolder = new Map<string, string[]>();
  const folderSet = new Set<string>();
  for (const row of rows) {
    folderSet.add(row.folder);
    const arr = filesByFolder.get(row.folder) ?? [];
    arr.push(row.slug);
    filesByFolder.set(row.folder, arr);
  }

  // Build child-dir lookup keyed by parent path ("" is root)
  const dirChildren = new Map<string, Set<string>>();
  for (const folder of folderSet) {
    if (!folder) continue;
    const parts = folder.split("/");
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      const child = parts.slice(0, i + 1).join("/");
      const set = dirChildren.get(parent) ?? new Set<string>();
      set.add(child);
      dirChildren.set(parent, set);
    }
  }

  function recurse(folder: string): { folder: string; slug: string } | null {
    // Visit subdirs first (sorted ASC) — matches `buildFileTree` which lists
    // directories before files at every level.
    const subs = Array.from(dirChildren.get(folder) ?? []).sort((a, b) => a.localeCompare(b));
    for (const sub of subs) {
      const leaf = sub.includes("/") ? sub.split("/").pop()! : sub;
      // Honor visible: false on subdirs.
      if (folderConfigs[leaf]?.visible === false) continue;
      const found = recurse(sub);
      if (found) return found;
    }
    // Fall through to files in this folder, ordered per its sort config.
    const slugs = filesByFolder.get(folder);
    if (slugs && slugs.length > 0) {
      const leaf = folder ? (folder.includes("/") ? folder.split("/").pop()! : folder) : "";
      const sort = folderConfigs[leaf]?.sort ?? "ASC";
      const sorted = slugs.slice().sort((a, b) =>
        sort === "DESC" ? b.localeCompare(a) : a.localeCompare(b),
      );
      return { folder, slug: sorted[0] };
    }
    return null;
  }

  return recurse("");
}

/** Recursively count all file nodes in a built subtree. */
function countFiles(nodes: object[]): number {
  let n = 0;
  for (const node of nodes) {
    const typed = node as { type: string; children?: object[] };
    if (typed.type === "file") n++;
    else if (typed.children) n += countFiles(typed.children);
  }
  return n;
}

function buildFileTree(
  dirPath: string,
  titleByPath: Map<string, string>,
  basePath: string = "",
  themeConfigs: Record<string, FolderConfig> = {},
  themeRootConfig: FolderConfig = {},
): object[] {
  if (!existsSync(dirPath)) return [];

  // Resolve which theme config applies to this directory.
  const folderLeaf = basePath
    ? (basePath.includes("/") ? basePath.split("/").pop()! : basePath)
    : "";
  const themeConfig = folderLeaf ? (themeConfigs[folderLeaf] ?? {}) : themeRootConfig;

  // Merge: yml overrides theme for fields it specifies; theme provides defaults.
  const ymlConfig = readFolderConfig(dirPath);
  const merged: FolderConfig = { ...themeConfig, ...ymlConfig };

  const sortOrder = merged.sort ?? "ASC";
  const folderHide = merged.hide ?? [];

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const dirs: object[] = [];
  const files: object[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const childDirPath = join(dirPath, entry.name);
      const childThemeCfg = themeConfigs[entry.name] ?? {};
      const childYmlCfg = readFolderConfig(childDirPath);
      const childMerged: FolderConfig = { ...childThemeCfg, ...childYmlCfg };
      if (childMerged.visible === false) continue;
      const children = buildFileTree(childDirPath, titleByPath, relativePath, themeConfigs, themeRootConfig);
      // Hide directories with no (visible) files in their subtree so stale
      // empty folders on disk don't leak into the tree.
      if (countFiles(children) === 0) continue;
      const dirNode: Record<string, unknown> = {
        name: entry.name,
        path: relativePath,
        type: "directory",
        children,
      };
      if (childMerged.showCount === true) {
        dirNode.count = countFiles(children);
      }
      if (childMerged.expanded === false) {
        dirNode.expanded = false;
      }
      dirs.push(dirNode);
    } else if (entry.name.endsWith(".md")) {
      // Apply folder-level hide patterns
      if (folderHide.length > 0 && matchesHidePattern(folderHide, entry.name)) continue;
      const node: Record<string, unknown> = {
        name: entry.name,
        path: relativePath,
        type: "file",
      };
      if (merged.created_at_prefix) {
        const datePrefix = entry.name.slice(0, 8);
        const stored = titleByPath.get(relativePath);
        node.title = stored ? `${datePrefix} ${stored}` : entry.name.replace(/\.md$/, "");
      } else {
        const title = titleByPath.get(relativePath);
        if (title) node.title = title;
      }
      files.push(node);
    }
  }

  // Apply directory/file ordering by this folder's sort config.
  const sortedDirs = sortOrder === "DESC" ? dirs.slice().reverse() : dirs;
  const sortedFiles = sortOrder === "DESC" ? files.slice().reverse() : files;

  // Mark the first N expanded, rest explicitly collapsed. The UI defaults to
  // "expanded" when the flag is absent, so both states must be set.
  if (merged.expandFirstN && merged.expandFirstN > 0) {
    for (let i = 0; i < sortedDirs.length; i++) {
      (sortedDirs[i] as Record<string, unknown>).expanded = i < merged.expandFirstN;
    }
  }

  return [...sortedDirs, ...sortedFiles];
}

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function resolveUiDistDir(): string {
  return resolveUiDist(__moduleDir) ?? join(__moduleDir, "../../../ui/dist");
}

function tryServeStatic(
  uiDistDir: string,
  pathname: string,
): Response | null {
  // Try exact file match
  const filePath = join(uiDistDir, pathname);
  const normalizedDist = join(uiDistDir, "/");
  const normalizedFile = join(filePath, "/").startsWith(normalizedDist)
    ? filePath
    : null;

  if (normalizedFile && existsSync(normalizedFile)) {
    try {
      const stat = statSync(normalizedFile);
      if (stat.isFile()) {
        return new Response(readFileSync(normalizedFile), {
          headers: { "Content-Type": getMimeType(normalizedFile) },
        });
      }
    } catch {
      // fall through
    }
  }

  // SPA fallback — serve index.html for non-API, non-asset routes
  const indexPath = join(uiDistDir, "index.html");
  if (existsSync(indexPath)) {
    return new Response(readFileSync(indexPath), {
      headers: { "Content-Type": "text/html" },
    });
  }

  return null;
}


export function createApiServer(
  home: string,
  port: number,
  collectionFilter?: string,
): { port: number; stop?: () => void } | Promise<{ port: number; stop?: () => void }> {
  const uiDistDir = resolveUiDistDir();
  const themeEngine = createThemeEngine();

  async function handleRequest(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      // Try management endpoints first (active in desktop mode)
      const mgmtResponse = handleManagementRequest(req);
      if (mgmtResponse) return mgmtResponse;

      // GET /api/collections
      if (path === "/api/collections" && req.method === "GET") {
        const rows = collectionFilter
          ? (() => { const col = getCollection(collectionFilter); return col ? [col] : []; })()
          : listCollections();
        const result = rows.map((r) => ({
          name: r.name,
          title: r.title ?? r.name,
          description: r.description,
          crawlerType: r.crawler,
          enabled: r.enabled,
          syncInterval: r.syncInterval,
          publish: r.publish,
        }));
        return jsonResponse(result);
      }

      // GET /api/collections/:name/tree
      const treeMatch = path.match(/^\/api\/collections\/([^/]+)\/tree$/);
      if (treeMatch && req.method === "GET") {
        const name = decodeURIComponent(treeMatch[1]);
        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        const contentDir = join(home, "collections", name, "content");

        const titleByPath = new Map<string, string>();
        const dbPath = getCollectionDbPath(name);
        if (existsSync(dbPath)) {
          const colDb = getCollectionDb(dbPath);
          const rows = colDb
            .select({ folder: entities.folder, slug: entities.slug, title: entities.title })
            .from(entities)
            .all();
          for (const row of rows) {
            const mdPath = entityMarkdownPath(row.folder, row.slug);
            if (mdPath && row.title) titleByPath.set(mdPath, row.title);
          }
        }

        const crawlerType = effectiveCrawlerType(col, dbPath);
        const themeConfigs = themeEngine.getFolderConfigs(crawlerType);
        const themeRootConfig = themeEngine.getRootConfig(crawlerType);
        const tree = buildFileTree(contentDir, titleByPath, "", themeConfigs, themeRootConfig);
        return jsonResponse(tree);
      }

      // GET /api/collections/:name/default-file
      const defaultFileMatch = path.match(
        /^\/api\/collections\/([^/]+)\/default-file$/,
      );
      if (defaultFileMatch && req.method === "GET") {
        const name = decodeURIComponent(defaultFileMatch[1]);
        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        const dbPath = getCollectionDbPath(name);
        if (!existsSync(dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(dbPath);
        const folderConfigs = themeEngine.getFolderConfigs(effectiveCrawlerType(col, dbPath));
        const rows: Array<{ folder: string; slug: string }> = [];
        for (const r of colDb
          .select({ folder: entities.folder, slug: entities.slug })
          .from(entities)
          .all()) {
          if (r.folder != null && r.slug != null) {
            rows.push({ folder: r.folder, slug: r.slug });
          }
        }
        const picked = pickFirstTreeFile(rows, folderConfigs);
        const filePath = picked ? entityMarkdownPath(picked.folder, picked.slug) : null;
        return jsonResponse({ file: filePath });
      }

      // GET /api/collections/:name/markdown/*path — render entity as markdown on-the-fly
      const markdownMatch = path.match(
        /^\/api\/collections\/([^/]+)\/markdown\/(.+)$/,
      );
      if (markdownMatch && req.method === "GET") {
        const name = decodeURIComponent(markdownMatch[1]);
        const filePath = decodeURIComponent(markdownMatch[2]);
        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        const dbPath = getCollectionDbPath(name);
        if (!existsSync(dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(dbPath);

        const { folder: mdFolder, slug: mdSlug } = splitMarkdownPath(filePath);
        const [entity] = colDb.select().from(entities)
          .where(and(eq(entities.folder, mdFolder ?? ""), eq(entities.slug, mdSlug ?? "")))
          .limit(1)
          .all();

        if (!entity) return errorResponse("File not found", 404);

        const crawlerType = effectiveCrawlerType(col, dbPath);
        if (!themeEngine.has(crawlerType)) {
          return errorResponse("No theme registered for this crawler", 404);
        }

        const entityDataObj = entity.data as EntityData;
        const sourceData = entityDataObj?.source ?? {};

        const lookupEntityPath = (externalId: string): string | undefined => {
          const [row] = colDb
            .select({ folder: entities.folder, slug: entities.slug })
            .from(entities)
            .where(eq(entities.externalId, externalId))
            .all();
          if (!row || row.folder == null || row.slug == null) return undefined;
          return row.folder ? `${row.folder}/${row.slug}` : row.slug;
        };

        const markdown = themeEngine.render({
          entity: {
            externalId: entity.externalId,
            entityType: entity.entityType,
            title: entity.title,
            data: sourceData,
            url: entityDataObj.url ?? undefined,
            tags: entityDataObj.tags ?? [],
          },
          collectionName: name,
          crawlerType,
          lookupEntityPath,
        });

        return new Response(markdown, {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      }

      // GET /api/collections/:name/html/*path — render entity as styled HTML
      const htmlMatch = path.match(
        /^\/api\/collections\/([^/]+)\/html\/(.+)$/,
      );
      if (htmlMatch && req.method === "GET") {
        const name = decodeURIComponent(htmlMatch[1]);
        const filePath = decodeURIComponent(htmlMatch[2]);
        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        const dbPath = getCollectionDbPath(name);
        if (!existsSync(dbPath))
          return errorResponse("Collection database not found", 404);

        const htmlCrawlerType = effectiveCrawlerType(col, dbPath);
        if (!themeEngine.hasHtmlRenderer(htmlCrawlerType)) {
          return errorResponse("HTML rendering not supported for this crawler", 404);
        }

        const colDb = getCollectionDb(dbPath);

        const { folder: htmlFolder, slug: htmlSlug } = splitMarkdownPath(filePath);
        const [entity] = colDb.select().from(entities)
          .where(and(eq(entities.folder, htmlFolder ?? ""), eq(entities.slug, htmlSlug ?? "")))
          .limit(1)
          .all();

        if (!entity) return errorResponse("Entity not found", 404);

        const entityDataObj = entity.data as EntityData;
        const sourceData = entityDataObj?.source ?? {};

        const lookupEntityPath = (externalId: string): string | undefined => {
          const [row] = colDb
            .select({ folder: entities.folder, slug: entities.slug })
            .from(entities)
            .where(eq(entities.externalId, externalId))
            .all();
          if (!row || row.folder == null || row.slug == null) return undefined;
          return row.folder ? `${row.folder}/${row.slug}` : row.slug;
        };

        const html = themeEngine.renderHtml({
          entity: {
            externalId: entity.externalId,
            entityType: entity.entityType,
            title: entity.title,
            data: sourceData,
            url: entityDataObj.url ?? undefined,
            tags: entityDataObj.tags ?? [],
          },
          collectionName: name,
          crawlerType: htmlCrawlerType,
          lookupEntityPath,
        });

        if (!html) return errorResponse("HTML rendering not available", 404);

        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // GET /api/collections/:name/html-support — check if HTML rendering is available
      const htmlSupportMatch = path.match(
        /^\/api\/collections\/([^/]+)\/html-support$/,
      );
      if (htmlSupportMatch && req.method === "GET") {
        const name = decodeURIComponent(htmlSupportMatch[1]);
        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);
        const htmlSupportDbPath = getCollectionDbPath(name);
        return jsonResponse({ supported: themeEngine.hasHtmlRenderer(effectiveCrawlerType(col, htmlSupportDbPath)) });
      }

      // GET /api/collections/:name/entities
      const entitiesMatch = path.match(
        /^\/api\/collections\/([^/]+)\/entities$/,
      );
      if (entitiesMatch && req.method === "GET") {
        const name = decodeURIComponent(entitiesMatch[1]);
        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        const dbPath = getCollectionDbPath(name);
        if (!existsSync(dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(dbPath);
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const entityType = url.searchParams.get("type");

        let query = colDb.select().from(entities);
        if (entityType) {
          query = query.where(eq(entities.entityType, entityType)) as typeof query;
        }

        const rows = query
          .orderBy(desc(entities.updatedAt))
          .limit(limit)
          .offset(offset)
          .all();

        const result = rows.map((row: any) => {
          const entityData = (row.data ?? {}) as EntityData;
          return {
            id: row.id,
            externalId: row.externalId,
            entityType: row.entityType,
            title: row.title,
            url: entityData.url ?? undefined,
            tags: entityData.tags ?? [],
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        });

        return jsonResponse({
          entities: result,
          pagination: { limit, offset, count: result.length },
        });
      }

      // GET /api/search
      if (path === "/api/search" && req.method === "GET") {
        const query = url.searchParams.get("q");
        if (!query) return errorResponse("Missing query parameter 'q'", 400);

        const collectionFilter = url.searchParams.get("collection");
        const typeFilter = url.searchParams.get("type");
        const limit = parseInt(url.searchParams.get("limit") || "20", 10);

        let collectionRows = collectionFilter
          ? (() => {
              const col = getCollection(collectionFilter);
              return col ? [col] : [];
            })()
          : listCollections();

        if (collectionFilter && collectionRows.length === 0)
          return errorResponse("Collection not found", 404);

        const allResults: Array<{
          collection: string;
          entityId: number;
          externalId: string;
          entityType: string;
          title: string;
          markdownPath: string | null;
          rank: number;
          snippet: string;
        }> = [];

        for (const col of collectionRows) {
          const dbPath = getCollectionDbPath(col.name);
          if (!existsSync(dbPath)) continue;

          const colDb = getCollectionDb(dbPath);
          const indexer = getCachedSearchIndexer(dbPath);
          const results = indexer.search(query, {
            entityType: typeFilter || undefined,
            limit,
          });
          if (results.length > 0) {
            const entityIds = results.map((r) => r.entityId);
            type SearchEntityRow = { id: number; folder: string | null; slug: string | null; title: string };
            const entityRows: SearchEntityRow[] = colDb
              .select({ id: entities.id, folder: entities.folder, slug: entities.slug, title: entities.title })
              .from(entities)
              .where(inArray(entities.id, entityIds))
              .all();
            const entityById = new Map<number, SearchEntityRow>(entityRows.map((e) => [e.id, e]));
            for (const r of results) {
              const entity = entityById.get(r.entityId);
              allResults.push({
                ...r,
                title: entity?.title ?? r.title,
                collection: col.name,
                markdownPath: entityMarkdownPath(entity?.folder, entity?.slug),
                snippet: r.snippet,
              });
            }
          }
        }

        allResults.sort((a, b) => a.rank - b.rank);
        return jsonResponse(allResults.slice(0, limit));
      }

      // GET /api/collections/:name/backlinks/*targetPath
      const backlinksMatch = path.match(
        /^\/api\/collections\/([^/]+)\/backlinks\/(.+)$/,
      );
      if (backlinksMatch && req.method === "GET") {
        const name = decodeURIComponent(backlinksMatch[1]);
        const targetFile = decodeURIComponent(backlinksMatch[2]);

        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        const dbPath = getCollectionDbPath(name);
        if (!existsSync(dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(dbPath);

        const { folder: targetFolder, slug: targetSlug } = splitMarkdownPath(targetFile);
        const [targetEntity] = colDb
          .select({ data: entities.data })
          .from(entities)
          .where(and(eq(entities.folder, targetFolder ?? ""), eq(entities.slug, targetSlug ?? "")))
          .limit(1)
          .all();
        const inLinkIds = new Set<string>(
          targetEntity ? ((targetEntity.data as EntityData).in_links ?? []) : [],
        );

        const results: Array<{
          entityId: number;
          externalId: string;
          entityType: string;
          title: string;
          markdownPath: string | null;
        }> = [];

        if (inLinkIds.size > 0) {
          const backlinkEntities = colDb.select().from(entities)
            .where(inArray(entities.externalId, [...inLinkIds]))
            .all();
          for (const entity of backlinkEntities) {
            const mdPath = entityMarkdownPath(entity.folder, entity.slug);
            const displayTitle = entity.slug ?? entity.title;
            results.push({
              entityId: entity.id,
              externalId: entity.externalId,
              entityType: entity.entityType,
              title: displayTitle,
              markdownPath: mdPath,
            });
          }
        }

        return jsonResponse(results);
      }

      // GET /api/collections/:name/outgoing-links/*sourcePath
      const outgoingMatch = path.match(
        /^\/api\/collections\/([^/]+)\/outgoing-links\/(.+)$/,
      );
      if (outgoingMatch && req.method === "GET") {
        const name = decodeURIComponent(outgoingMatch[1]);
        const sourceFile = decodeURIComponent(outgoingMatch[2]);

        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        const dbPath = getCollectionDbPath(name);
        if (!existsSync(dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(dbPath);

        const { folder: sfFolder, slug: sfSlug } = splitMarkdownPath(sourceFile);
        const [sourceEntity] = colDb.select().from(entities)
          .where(and(eq(entities.folder, sfFolder ?? ""), eq(entities.slug, sfSlug ?? "")))
          .limit(1)
          .all();

        if (!sourceEntity) return jsonResponse([]);

        const outLinks: string[] = (sourceEntity.data as EntityData).out_links ?? [];
        if (outLinks.length === 0) return jsonResponse([]);

        const linkedEntities = colDb.select().from(entities)
          .where(inArray(entities.externalId, outLinks))
          .all();

        const results = linkedEntities.map((entity: { folder: string | null; slug: string | null; title: string }) => {
          const mdPath = entityMarkdownPath(entity.folder, entity.slug);
          const displayTitle = entity.slug ?? entity.title;
          return { title: displayTitle, markdownPath: mdPath };
        });

        results.sort((a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title));
        return jsonResponse(results);
      }

      // GET /api/collections/:name/textpack/*path — download page as TextPack (zipped TextBundle)
      const textpackMatch = path.match(
        /^\/api\/collections\/([^/]+)\/textpack\/(.+)$/,
      );
      if (textpackMatch && req.method === "GET") {
        const name = decodeURIComponent(textpackMatch[1]);
        const filePath = decodeURIComponent(textpackMatch[2]);
        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        const { buildTextPack } = await import("@frozenink/core/export");
        const result = buildTextPack(name, filePath);
        if (!result) return errorResponse("File not found", 404);

        const zipData = Uint8Array.from(result.data);
        return new Response(zipData, {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${result.filename}"`,
          },
        });
      }

      // GET /api/attachments/:collection/*path
      const attachMatch = path.match(
        /^\/api\/attachments\/([^/]+)\/(.+)$/,
      );
      if (attachMatch && req.method === "GET") {
        const collectionName = decodeURIComponent(attachMatch[1]);
        const filePath = decodeURIComponent(attachMatch[2]);

        const fullPath = join(
          home,
          "collections",
          collectionName,
          "attachments",
          filePath,
        );

        // Prevent path traversal
        const collectionsBase = join(home, "collections", collectionName);
        if (!fullPath.startsWith(collectionsBase)) {
          return errorResponse("Forbidden", 403);
        }

        if (!existsSync(fullPath)) {
          return errorResponse("Attachment not found", 404);
        }

        const content = readFileSync(fullPath);
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": getMimeType(fullPath) },
        });
      }

      // GET /api/collections/:name/file/*storagePath — serve a stored asset by its
      // storagePath (relative to the collection root, e.g. content/xdebug/issues/assets/981-foo.png).
      // Used by the HTML theme to render inline images and lazy-load text attachments.
      const collectionFileMatch = path.match(
        /^\/api\/collections\/([^/]+)\/file\/(.+)$/,
      );
      if (collectionFileMatch && req.method === "GET") {
        const colName = decodeURIComponent(collectionFileMatch[1]);
        const filePath = decodeURIComponent(collectionFileMatch[2]);
        const collectionDir = join(home, "collections", colName);
        const fullPath = join(collectionDir, filePath);

        // Prevent path traversal
        if (!join(fullPath, "/").startsWith(join(collectionDir, "/"))) {
          return errorResponse("Forbidden", 403);
        }

        if (!existsSync(fullPath)) {
          return errorResponse("File not found", 404);
        }

        const fileContent = readFileSync(fullPath);
        return new Response(fileContent, {
          status: 200,
          headers: { "Content-Type": getMimeType(fullPath) },
        });
      }

      // Serve static UI files for non-API routes
      if (!path.startsWith("/api/")) {
        const staticResponse = tryServeStatic(uiDistDir, path);
        if (staticResponse) return staticResponse;
      }

      return errorResponse("Not found", 404);
  }

  if (isBun) {
    try {
      const server = Bun.serve({ port, fetch: handleRequest });
      return { port: server.port as number, stop: () => server.stop() };
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        console.error(`Error: Port ${port} is already in use.`);
        console.error(`Use --port <number> to choose a different port, or stop the process using port ${port}.`);
        process.exit(1);
      }
      throw err;
    }
  }

  // Node.js / Electron: plain http server
  const http = require("node:http");
  const nodeServer = http.createServer(async (nodeReq: any, nodeRes: any) => {
    try {
      const actualPort = (nodeServer.address() as any)?.port ?? port;
      const url = `http://localhost:${actualPort}${nodeReq.url}`;
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(nodeReq.headers)) {
        if (typeof value === "string") headers[key] = value;
      }

      // Collect body for POST/PATCH/PUT
      let bodyBuf: Buffer | undefined;
      if (nodeReq.method !== "GET" && nodeReq.method !== "HEAD") {
        const chunks: Buffer[] = [];
        for await (const chunk of nodeReq) chunks.push(chunk);
        bodyBuf = Buffer.concat(chunks);
      }

      const req = new Request(url, {
        method: nodeReq.method,
        headers,
        body: bodyBuf as BodyInit | undefined,
      });

      // handleRequest may return a Promise<Response> for async management endpoints
      const res = await Promise.resolve(handleRequest(req));
      nodeRes.writeHead(res.status, Object.fromEntries(res.headers.entries()));
      const body = await res.arrayBuffer();
      nodeRes.end(Buffer.from(body));
    } catch (err) {
      console.error("Server request error:", err);
      nodeRes.writeHead(500);
      nodeRes.end("Internal Server Error");
    }
  });

  // Return a promise that resolves once the server is listening,
  // with the actual assigned port (important when port=0).
  return new Promise((resolve, reject) => {
    nodeServer.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE") {
        console.error(`Error: Port ${port} is already in use.`);
        console.error(`Use --port <number> to choose a different port, or stop the process using port ${port}.`);
        process.exit(1);
      }
      reject(err);
    });
    nodeServer.listen(port, () => {
      const addr = nodeServer.address() as any;
      const actualPort = typeof addr === "object" ? addr.port : port;
      resolve({ port: actualPort, stop: () => nodeServer.close() });
    });
  });
}

export const serveCommand = new Command("serve")
  .description("Start the API and/or MCP server")
  .argument("[collection-name]", "Serve only this collection")
  .option("--mcp-only", "Start only the MCP server (no REST API)")
  .option("--ui-only", "Start only the REST API server (no MCP)")
  .option("--port <port>", "Port for the REST API server")
  .addHelpText("after", `
Examples:
  # Start API server + web UI for all collections
  fink serve

  # Serve a single collection
  fink serve my-vault

  # Start MCP server only (no web UI)
  fink serve --mcp-only

  # Start on a custom port
  fink serve --port 8080
`)
  .action(async (collectionName: string | undefined, opts: { mcpOnly?: boolean; uiOnly?: boolean; port?: string }) => {
    const home = getFrozenInkHome();

    ensureInitialized();

    if (collectionName) {
      const col = getCollection(collectionName);
      if (!col) {
        console.error(`Error: Collection "${collectionName}" not found.`);
        process.exit(1);
      }
    }

    const config = loadConfig();
    const port = opts.port ? parseInt(opts.port, 10) : config.ui.port;

    await prepareCollections(home, console.log, collectionName);

    if (opts.mcpOnly) {
      console.error("Starting Frozen Ink MCP server (STDIO)...");
      await startStdioServer({ frozeninkHome: home });
      return;
    }

    if (opts.uiOnly) {
      const server = await Promise.resolve(createApiServer(home, port, collectionName));
      console.log(`Frozen Ink API server running on http://localhost:${server.port}`);
      return;
    }

    // Start both
    const server = await Promise.resolve(createApiServer(home, port, collectionName));
    console.log(`Frozen Ink API server running on http://localhost:${server.port}`);
    console.error("Starting Frozen Ink MCP server (STDIO)...");
    await startStdioServer({ frozeninkHome: home });
  });
