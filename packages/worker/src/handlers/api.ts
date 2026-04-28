import { Hono } from "hono";
import type { Env } from "../types";
import {
  getEntities,
  getEntityByExternalId,
  getEntityByFolderSlug,
  getEntityCount,
  getBacklinks,
  getOutgoingLinks,
  getEntitiesByExternalIds,
  getFullManifest,
  parseEntityData,
  entityMarkdownPath,
} from "../db/client";
import type { Entity } from "../db/client";
import { getCollections, getCollectionConfig } from "../config";
import { searchEntities } from "../db/search";
import { getR2Object, getMimeType } from "../storage/r2";
import { ThemeEngine } from "@frozenink/core/theme";
import type { ThemeRenderContext, FolderConfig } from "@frozenink/core/theme";
import { GitHubTheme, ObsidianTheme, GitTheme, MantisHubTheme, RssTheme } from "@frozenink/crawlers/themes";

const themeEngine = new ThemeEngine();
themeEngine.register(new GitHubTheme());
themeEngine.register(new ObsidianTheme());
themeEngine.register(new GitTheme());
themeEngine.register(new MantisHubTheme());
themeEngine.register(new RssTheme());

export function buildRenderContext(
  collectionName: string,
  crawlerType: string,
  entity: Entity,
): ThemeRenderContext {
  const entityData = parseEntityData(entity);
  return {
    entity: {
      externalId: entity.external_id,
      entityType: entity.entity_type,
      title: entity.title,
      data: (entityData.source ?? {}) as Record<string, unknown>,
      url: entityData.url ?? undefined,
      tags: entityData.tags ?? [],
    },
    collectionName,
    crawlerType,
  };
}

declare const __BUILD_ID__: string;

const api = new Hono<{ Bindings: Env }>();

// GET /api/app-info
api.get("/api/app-info", (c) => {
  return c.json({ mode: "published" });
});

// GET /api/collections
api.get("/api/collections", async (c) => {
  const collections = await getCollections(c.env.BUCKET);
  const entityCount = await getEntityCount(c.env.DB);
  // collections.yml only stores names — titles live in per-collection yml.
  const configs = await Promise.all(
    collections.map((col) => getCollectionConfig(c.env.BUCKET, col.name)),
  );
  const result = collections.map((col, i) => {
    const cfg = configs[i];
    return {
      name: col.name,
      title: cfg?.title || col.name,
      enabled: true,
      entityCount,
    };
  });
  return c.json(result);
});

// GET /api/collections/:name/html-support
api.get("/api/collections/:name/html-support", async (c) => {
  const name = c.req.param("name");
  const col = await getCollectionConfig(c.env.BUCKET, name);
  if (!col?.crawler) return c.json({ supported: false });
  return c.json({ supported: themeEngine.hasHtmlRenderer(col.crawler) });
});

// GET /api/collections/:name/html/*
api.get("/api/collections/:name/html/*", async (c) => {
  const name = c.req.param("name");
  const col = await getCollectionConfig(c.env.BUCKET, name);
  if (!col?.crawler || !themeEngine.hasHtmlRenderer(col.crawler)) {
    return c.text("HTML not supported for this collection", 404);
  }

  const filePath = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/html/`, "");
  const decoded = decodeURIComponent(filePath);

  const slash = decoded.lastIndexOf("/");
  const htmlFolder = slash >= 0 ? decoded.slice(0, slash) : "";
  const htmlSlug = decoded.slice(slash + 1).replace(/\.md$/, "");
  const entity = await getEntityByFolderSlug(c.env.DB, htmlFolder, htmlSlug);
  if (!entity) return c.text("Entity not found", 404);

  const ctx = buildRenderContext(name, col.crawler, entity);
  const html = themeEngine.renderHtml(ctx);
  if (!html) return c.text("HTML rendering failed", 500);

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

// GET /api/collections/:name/tree
api.get("/api/collections/:name/tree", async (c) => {
  const name = c.req.param("name");
  const col = await getCollectionConfig(c.env.BUCKET, name);
  // D1 .all() returns max 5000 rows — paginate to fetch all entities. Pull
  // `data` too so we can extract per-entity sortKey for the tree sort.
  const allResults: Array<{ folder: string; slug: string; title: string; data: string }> = [];
  const PAGE_SIZE = 5000;
  let offset = 0;
  for (;;) {
    const { results } = await c.env.DB.prepare(
      "SELECT folder, slug, title, data FROM entities WHERE folder IS NOT NULL AND slug IS NOT NULL LIMIT ? OFFSET ?",
    ).bind(PAGE_SIZE, offset).all<{ folder: string; slug: string; title: string; data: string }>();
    if (!results || results.length === 0) break;
    allResults.push(...results);
    if (results.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const labelWithTitle = col?.crawler ? themeEngine.labelFilesWithTitle(col.crawler) : true;
  const titleByPath = new Map<string, string>();
  const sortKeyByPath = new Map<string, string>();
  const mdPaths = allResults
    .map((row) => {
      const rel = row.folder ? `${row.folder}/${row.slug}.md` : `${row.slug}.md`;
      if (labelWithTitle && row.title) titleByPath.set(rel, row.title);
      try {
        const data = row.data ? JSON.parse(row.data) : null;
        const sortKey = data?.sortKey;
        if (typeof sortKey === "string" && sortKey) sortKeyByPath.set(rel, sortKey);
      } catch { /* malformed data — skip sortKey */ }
      return rel;
    })
    .filter((p) => p.endsWith(".md"));

  // Derive folder configs from the theme (static defaults) and merge per-collection
  // overrides that publish wrote to _config/{name}-folders.json (source .folder.yml,
  // collection hide patterns, etc.).
  const folderConfigs = new Map<string, { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[]; showCount?: boolean; expandFirstN?: number; expanded?: boolean; created_at_prefix?: boolean }>();
  const rootConfig: { hide?: string[]; sort?: "ASC" | "DESC"; expandFirstN?: number } = {};

  let collectionFolderOverrides: Record<string, FolderConfig> = {};
  try {
    const obj = await c.env.BUCKET.get(`_config/${name}-folders.json`);
    if (obj) collectionFolderOverrides = await obj.json<Record<string, FolderConfig>>();
  } catch { /* no overrides */ }

  if (col?.crawler) {
    const themeFolderConfigs = themeEngine.getFolderConfigs(col.crawler);
    const themeRootConfig = themeEngine.getRootConfig(col.crawler);
    if (themeRootConfig.hide) rootConfig.hide = themeRootConfig.hide;
    if (themeRootConfig.sort) rootConfig.sort = themeRootConfig.sort;
    if (themeRootConfig.expandFirstN) rootConfig.expandFirstN = themeRootConfig.expandFirstN;

    // Map folder-name-based configs to actual folder paths found in the entity paths
    const folderPaths = new Set<string>();
    for (const mdPath of mdPaths) {
      const parts = mdPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        folderPaths.add(parts.slice(0, i).join("/"));
      }
    }
    for (const folderPath of folderPaths) {
      const folderName = folderPath.split("/").pop()!;
      if (themeFolderConfigs[folderName]) {
        folderConfigs.set(folderPath, themeFolderConfigs[folderName]);
      }
    }
  }

  // Overlay per-collection overrides on top of theme defaults (root and subdirs).
  const rootOverride = collectionFolderOverrides[""];
  if (rootOverride) {
    if (rootOverride.sort) rootConfig.sort = rootOverride.sort;
    if (rootOverride.hide) rootConfig.hide = rootOverride.hide;
  }
  for (const [path, cfg] of Object.entries(collectionFolderOverrides)) {
    if (path === "") continue;
    const existing = folderConfigs.get(path) ?? {};
    folderConfigs.set(path, { ...existing, ...cfg });
  }

  // Store root config at "" key so sortTree can apply it at the root level
  folderConfigs.set("", rootConfig);

  // Apply root-level hide patterns to files at the root (no subdirectory)
  const rootHideCompiled = compileHidePatterns(rootConfig.hide ?? []);
  const filteredPaths = mdPaths.filter((p) => {
    const parts = p.split("/");
    if (parts.length === 1 && rootHideCompiled.length > 0) {
      return !matchesHidePattern(rootHideCompiled, parts[0]);
    }
    return true;
  });

  const tree = buildTreeFromPaths(filteredPaths, titleByPath, folderConfigs, sortKeyByPath);
  return c.json(tree);
});

// GET /api/collections/:name/default-file
api.get("/api/collections/:name/default-file", async (c) => {
  const name = c.req.param("name");
  const col = await getCollectionConfig(c.env.BUCKET, name);

  // Load every (folder, slug) so we can mirror the tree-walk ordering used by
  // the sidebar: subdirs first (ASC), then files within the leaf folder sorted
  // per the folder's theme config (e.g. DESC for issues).
  const PAGE_SIZE_D1 = 5000;
  const all: Array<{ folder: string; slug: string }> = [];
  let offset = 0;
  for (;;) {
    const { results } = await c.env.DB.prepare(
      "SELECT folder, slug FROM entities WHERE folder IS NOT NULL AND slug IS NOT NULL LIMIT ? OFFSET ?",
    ).bind(PAGE_SIZE_D1, offset).all<{ folder: string; slug: string }>();
    if (!results || results.length === 0) break;
    all.push(...results);
    if (results.length < PAGE_SIZE_D1) break;
    offset += PAGE_SIZE_D1;
  }

  if (all.length === 0) return c.json({ file: null });

  const folderConfigs: Record<string, FolderConfig> = col?.crawler ? { ...themeEngine.getFolderConfigs(col.crawler) } : {};
  // Overlay per-collection overrides (same JSON the tree endpoint reads). The
  // root override ("" key) lands in folderConfigs[""] so pickFirstTreeFile
  // honors the DESC/ASC setting at the content root.
  try {
    const obj = await c.env.BUCKET.get(`_config/${name}-folders.json`);
    if (obj) {
      const overrides = await obj.json<Record<string, FolderConfig>>();
      for (const [path, cfg] of Object.entries(overrides)) {
        const key = path === "" ? "" : (path.includes("/") ? path.split("/").pop()! : path);
        folderConfigs[key] = { ...(folderConfigs[key] ?? {}), ...cfg };
      }
    }
  } catch { /* no overrides */ }
  const picked = pickFirstTreeFile(all, folderConfigs);
  if (!picked) return c.json({ file: null });
  const filePath = picked.folder ? `${picked.folder}/${picked.slug}.md` : `${picked.slug}.md`;
  return c.json({ file: filePath });
});

// GET /api/collections/:name/markdown/*
api.get("/api/collections/:name/markdown/*", async (c) => {
  const name = c.req.param("name");
  const col = await getCollectionConfig(c.env.BUCKET, name);
  if (!col?.crawler) return c.text("Collection not found", 404);

  const filePath = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/markdown/`, "");
  const decoded = decodeURIComponent(filePath);

  const mdSlash = decoded.lastIndexOf("/");
  const mdFolder = mdSlash >= 0 ? decoded.slice(0, mdSlash) : "";
  const mdSlug = decoded.slice(mdSlash + 1).replace(/\.md$/, "");
  const entity = await getEntityByFolderSlug(c.env.DB, mdFolder, mdSlug);
  if (!entity) return c.text("File not found", 404);

  const ctx = buildRenderContext(name, col.crawler, entity);
  const markdown = themeEngine.render(ctx);

  return new Response(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
});

// GET /api/collections/:name/entities
api.get("/api/collections/:name/entities", async (c) => {
  const name = c.req.param("name");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const entityType = c.req.query("type") || undefined;

  const rows = await getEntities(c.env.DB, { limit, offset, entityType });

  const result = rows.map((row) => {
    const ed = parseEntityData(row);
    return {
      id: row.id,
      externalId: row.external_id,
      entityType: row.entity_type,
      title: row.title,
      url: ed.url ?? null,
      tags: ed.tags ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return c.json({
    entities: result,
    pagination: { limit, offset, count: result.length },
  });
});

// GET /api/collections/:name/info
// Returns summary metadata about a collection — intended for discovery and to
// let clients decide whether a full manifest pull is worthwhile.
// Cached in R2 at `_cache/info-{buildId}-{name}.json`; the buildId prefix means
// worker redeploys automatically bypass old caches. Publish invalidates the
// current-buildId key alongside the manifest cache.
api.get("/api/collections/:name/info", async (c) => {
  const name = c.req.param("name");
  const col = await getCollectionConfig(c.env.BUCKET, name);
  if (!col) return c.json({ error: "Collection not found" }, 404);

  const cacheKey = `_cache/info-${__BUILD_ID__}-${name}.json`;
  const cached = await c.env.BUCKET.get(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      headers: { "content-type": "application/json" },
    });
  }

  const manifest = await getFullManifest(c.env.DB);
  const entityCount = manifest.length;

  // Aggregate per-type counts, total data size (bytes of stored JSON), and the
  // most recent updated_at so clients can tell at a glance how big a sync is
  // and whether anything changed since their last pull.
  const typeRows = await c.env.DB.prepare(
    "SELECT entity_type, COUNT(*) as count FROM entities GROUP BY entity_type",
  ).all<{ entity_type: string; count: number }>();
  const entityTypes: Record<string, number> = {};
  for (const row of typeRows.results ?? []) {
    entityTypes[row.entity_type] = row.count;
  }

  const sizeRow = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(LENGTH(data)), 0) as bytes, MAX(updated_at) as last FROM entities",
  ).first<{ bytes: number; last: string | null }>();

  // manifestHash: a stable fingerprint of every (externalId, hash) pair so
  // clients can cheaply detect "nothing changed" without downloading the full
  // entity list. Same input as the manifest body → same hash.
  const fingerprint = manifest.map((e) => `${e.externalId}\t${e.hash}`).join("\n");
  const fpBytes = new TextEncoder().encode(fingerprint);
  const digest = await crypto.subtle.digest("SHA-256", fpBytes);
  const manifestHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const body = {
    version: 1,
    name: col.name,
    title: col.title || col.name,
    description: col.description ?? null,
    crawlerType: col.crawler,
    entityCount,
    entityTypes,
    totalDataBytes: sizeRow?.bytes ?? 0,
    lastUpdatedAt: sizeRow?.last ?? null,
    manifestVersion: 1,
    manifestHash,
    capabilities: ["bulk-entities", "html-render"],
    workerBuildId: __BUILD_ID__,
    generatedAt: new Date().toISOString(),
  };
  const bodyJson = JSON.stringify(body);

  await c.env.BUCKET.put(cacheKey, bodyJson, {
    httpMetadata: { contentType: "application/json" },
  });

  return new Response(bodyJson, {
    headers: { "content-type": "application/json" },
  });
});

// GET /api/collections/:name/manifest
api.get("/api/collections/:name/manifest", async (c) => {
  const name = c.req.param("name");
  const col = await getCollectionConfig(c.env.BUCKET, name);
  if (!col) return c.json({ error: "Collection not found" }, 404);

  // Serve from R2 cache if present. Publish invalidates the cache so stale
  // reads aren't possible after a re-publish.
  const cacheKey = `_cache/manifest-${name}.json`;
  const cached = await c.env.BUCKET.get(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      headers: { "content-type": "application/json" },
    });
  }

  const manifest = await getFullManifest(c.env.DB);
  const entitiesStr = manifest
    .map((e) => `${e.externalId}\t${e.hash}`)
    .join("\n");

  const body = {
    version: 1,
    capabilities: ["bulk-entities", "html-render"],
    collection: {
      name: col.name,
      title: col.title || col.name,
      crawlerType: col.crawler,
    },
    entities: entitiesStr,
  };
  const bodyJson = JSON.stringify(body);

  await c.env.BUCKET.put(cacheKey, bodyJson, {
    httpMetadata: { contentType: "application/json" },
  });

  return new Response(bodyJson, {
    headers: { "content-type": "application/json" },
  });
});

// GET /api/collections/:name/entities/bulk?externalIds=...
api.get("/api/collections/:name/entities/bulk", async (c) => {
  const name = c.req.param("name");
  const idsParam = c.req.query("externalIds") || "";
  const externalIds = idsParam.split(",").filter(Boolean).slice(0, 50);

  if (externalIds.length === 0) {
    return c.json({ entities: [] });
  }

  const rows = await getEntitiesByExternalIds(c.env.DB, externalIds);

  const result = rows.map((row) => {
    const entityData = parseEntityData(row);
    return {
      externalId: row.external_id,
      entityType: row.entity_type,
      title: row.title,
      data: entityData,
      hash: row.content_hash ?? "",
      markdownPath: entityMarkdownPath(row),
      url: entityData.url ?? null,
      tags: entityData.tags ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return c.json({ entities: result });
});

// GET /api/search
api.get("/api/search", async (c) => {
  const query = c.req.query("q");
  if (!query) return c.json({ error: "Missing query parameter 'q'" }, 400);

  const collection = c.req.query("collection") || undefined;
  const entityType = c.req.query("type") || undefined;
  const limit = parseInt(c.req.query("limit") || "20", 10);

  const results = await searchEntities(c.env.DB, query, {
    entityType,
    limit,
  });

  const externalIds = results.map((r) => r.externalId);
  const entitiesList = await getEntitiesByExternalIds(c.env.DB, externalIds);
  const entityMap = new Map(entitiesList.map((e) => [e.external_id, e]));
  const enriched = results.map((r) => {
    const entity = entityMap.get(r.externalId) ?? null;
    const markdownPath = entity ? entityMarkdownPath(entity) : null;
    return { ...r, title: entity?.title ?? r.title, collection: collection ?? "", markdownPath, snippet: r.snippet };
  });

  return c.json(enriched);
});

// Resolve an entity from a markdown path like "mantisbt/issues/36614-foo.md".
// The UI always has the path, not the external_id, so we derive folder/slug
// and look up by the indexed (folder, slug) columns.
async function resolveEntityFromPath(
  db: D1Database,
  path: string,
): Promise<Awaited<ReturnType<typeof getEntityByFolderSlug>>> {
  const decoded = decodeURIComponent(path).replace(/\.md$/, "");
  const lastSlash = decoded.lastIndexOf("/");
  const folder = lastSlash >= 0 ? decoded.slice(0, lastSlash) : "";
  const slug = lastSlash >= 0 ? decoded.slice(lastSlash + 1) : decoded;
  return getEntityByFolderSlug(db, folder, slug);
}

// GET /api/collections/:name/backlinks/<markdown path>
api.get("/api/collections/:name/backlinks/*", async (c) => {
  const name = c.req.param("name");
  const targetPath = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/backlinks/`, "");

  const targetEntity = await resolveEntityFromPath(c.env.DB, targetPath);
  if (!targetEntity) return c.json({ error: "Entity not found" }, 404);

  const links = await getBacklinks(c.env.DB, targetEntity);

  const results = links.map(({ entity }) => {
    const mdPath = entityMarkdownPath(entity);
    const displayTitle = entity.title ?? entity.slug;
    return {
      entityId: entity.id,
      externalId: entity.external_id,
      entityType: entity.entity_type,
      title: displayTitle,
      markdownPath: mdPath,
    };
  });

  return c.json(results);
});

// GET /api/collections/:name/outgoing-links/<markdown path>
api.get("/api/collections/:name/outgoing-links/*", async (c) => {
  const name = c.req.param("name");
  const targetPath = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/outgoing-links/`, "");

  const sourceEntity = await resolveEntityFromPath(c.env.DB, targetPath);
  if (!sourceEntity) return c.json({ error: "Entity not found" }, 404);

  const links = await getOutgoingLinks(c.env.DB, sourceEntity);

  const results = links
    .filter(({ entity }) => entity !== null)
    .map(({ entity }) => {
      const mdPath = entityMarkdownPath(entity!);
      const displayTitle = entity!.title ?? entity!.slug;
      return { title: displayTitle, markdownPath: mdPath };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return c.json(results);
});

// GET /api/attachments/:collection/*
api.get("/api/attachments/:collection/*", async (c) => {
  const collection = c.req.param("collection");
  const filePath = c.req.path.replace(`/api/attachments/${encodeURIComponent(collection)}/`, "");
  const decoded = decodeURIComponent(filePath);

  const r2Key = `${collection}/attachments/${decoded}`;
  const obj = await getR2Object(c.env.BUCKET, r2Key);
  if (!obj) return c.text("Attachment not found", 404);

  return new Response(obj.body, {
    headers: { "Content-Type": getMimeType(decoded) },
  });
});

function compileHidePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  ));
}

function matchesHidePattern(compiled: RegExp[], filename: string): boolean {
  return compiled.some((re) => re.test(filename));
}

/**
 * Pick the first file in visible tree order: subdirs first (sorted ASC),
 * then files in the leaf folder sorted per its theme config (ASC/DESC).
 * Mirrors what the sidebar renders so the default-open file matches.
 */
function pickFirstTreeFile(
  rows: Array<{ folder: string; slug: string }>,
  folderConfigs: Record<string, FolderConfig>,
): { folder: string; slug: string } | null {
  const filesByFolder = new Map<string, string[]>();
  const folderSet = new Set<string>();
  for (const row of rows) {
    folderSet.add(row.folder);
    const arr = filesByFolder.get(row.folder) ?? [];
    arr.push(row.slug);
    filesByFolder.set(row.folder, arr);
  }

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
    const subs = Array.from(dirChildren.get(folder) ?? []).sort((a, b) => a.localeCompare(b));
    for (const sub of subs) {
      const leaf = sub.includes("/") ? sub.split("/").pop()! : sub;
      if (folderConfigs[leaf]?.visible === false) continue;
      const found = recurse(sub);
      if (found) return found;
    }
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

// Helper to build tree from flat file paths, honoring folder yml configs
function buildTreeFromPaths(
  paths: string[],
  titleByPath: Map<string, string> = new Map(),
  folderConfigs: Map<string, { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[]; showCount?: boolean; expandFirstN?: number; expanded?: boolean; created_at_prefix?: boolean }> = new Map(),
  sortKeyByPath: Map<string, string> = new Map(),
): object[] {
  interface TreeNode {
    name: string;
    path: string;
    type: "directory" | "file";
    title?: string;
    count?: number;
    expanded?: boolean;
    children?: TreeNode[];
  }

  function countFilesInTree(nodes: TreeNode[]): number {
    let n = 0;
    for (const node of nodes) {
      if (node.type === "file") n++;
      else if (node.children) n += countFilesInTree(node.children);
    }
    return n;
  }

  const root: TreeNode[] = [];
  const rootMap = new Map<string, TreeNode>();
  const dirChildMaps = new WeakMap<TreeNode, Map<string, TreeNode>>();

  for (const filePath of paths.sort()) {
    const parts = filePath.split("/");
    let currentArr = root;
    let currentMap = rootMap;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partialPath = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;

      if (isFile) {
        const node: TreeNode = { name: part, path: partialPath, type: "file" };
        const title = titleByPath.get(partialPath);
        if (title) node.title = title;
        currentArr.push(node);
      } else {
        let dir = currentMap.get(part);
        if (!dir) {
          dir = { name: part, path: partialPath, type: "directory", children: [] };
          currentArr.push(dir);
          currentMap.set(part, dir);
          dirChildMaps.set(dir, new Map());
        }
        currentArr = dir.children!;
        currentMap = dirChildMaps.get(dir)!;
      }
    }
  }

  function sortTree(nodes: TreeNode[], parentPath: string = ""): TreeNode[] {
    const config = folderConfigs.get(parentPath);
    const sortOrder = config?.sort ?? "ASC";
    const folderHideCompiled = compileHidePatterns(config?.hide ?? []);

    const dirs = nodes
      .filter((n) => n.type === "directory")
      .filter((n) => {
        const childPath = parentPath ? `${parentPath}/${n.name}` : n.name;
        return folderConfigs.get(childPath)?.visible !== false;
      });
    if (sortOrder === "DESC") {
      dirs.sort((a, b) => b.name.localeCompare(a.name));
    } else {
      dirs.sort((a, b) => a.name.localeCompare(b.name));
    }
    for (const dir of dirs) {
      const childPath = parentPath ? `${parentPath}/${dir.name}` : dir.name;
      if (folderConfigs.get(childPath)?.expanded === false) {
        dir.expanded = false;
      }
    }
    if (config?.expandFirstN && config.expandFirstN > 0) {
      // Mark first N expanded, rest explicitly collapsed. The UI falls back to
      // "expanded" when the flag is absent, so both sides must be set.
      for (let i = 0; i < dirs.length; i++) {
        dirs[i].expanded = i < config.expandFirstN;
      }
    }

    const files = nodes
      .filter((n) => n.type === "file")
      .filter((n) => folderHideCompiled.length === 0 || !matchesHidePattern(folderHideCompiled, n.name));
    const fileEffectiveKey = (f: TreeNode): string => sortKeyByPath.get(f.path) ?? f.name;
    files.sort((a, b) => {
      const ka = fileEffectiveKey(a);
      const kb = fileEffectiveKey(b);
      return sortOrder === "DESC" ? kb.localeCompare(ka) : ka.localeCompare(kb);
    });
    if (config?.created_at_prefix) {
      for (const file of files) {
        const datePrefix = file.name.slice(0, 8);
        const stored = titleByPath.get(file.path);
        file.title = stored ? `${datePrefix} ${stored}` : file.name.replace(/\.md$/, "");
      }
    }

    for (const dir of dirs) {
      const childPath = parentPath ? `${parentPath}/${dir.name}` : dir.name;
      if (dir.children) {
        dir.children = sortTree(dir.children, childPath);
      }
      if (folderConfigs.get(childPath)?.showCount === true) {
        dir.count = countFilesInTree(dir.children ?? []);
      }
    }
    return [...dirs, ...files];
  }

  return sortTree(root);
}

export { api };
