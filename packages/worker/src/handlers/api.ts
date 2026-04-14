import { Hono } from "hono";
import type { Env } from "../types";
import {
  getCollections,
  getCollection,
  getEntities,
  getEntityByExternalId,
  getEntityByMarkdownPath,
  getEntityMarkdownPathByExternalId,
  getEntityTags,
  getEntityCount,
  getBacklinks,
  getOutgoingLinks,
} from "../db/client";
import type { Entity } from "../db/client";
import { searchEntities } from "../db/search";
import { getR2Object, getMimeType } from "../storage/r2";
import { ThemeEngine } from "@frozenink/core/theme";
import type { ThemeRenderContext } from "@frozenink/core/theme";
import { GitHubTheme, ObsidianTheme, GitTheme, MantisHubTheme } from "@frozenink/crawlers/themes";

const themeEngine = new ThemeEngine();
themeEngine.register(new GitHubTheme());
themeEngine.register(new ObsidianTheme());
themeEngine.register(new GitTheme());
themeEngine.register(new MantisHubTheme());

export async function buildRenderContext(
  db: D1Database,
  collectionName: string,
  crawlerType: string,
  entity: Entity,
): Promise<ThemeRenderContext> {
  const [tags, allEntities] = await Promise.all([
    getEntityTags(db, collectionName, entity.id),
    db.prepare("SELECT external_id, markdown_path FROM entities WHERE collection_name = ?")
      .bind(collectionName)
      .all<{ external_id: string; markdown_path: string | null }>()
      .then((r) => r.results ?? []),
  ]);

  const entityPathMap = new Map<string, string>();
  for (const row of allEntities) {
    if (!row.markdown_path) continue;
    const prefix = "content/";
    const rel = row.markdown_path.startsWith(prefix) ? row.markdown_path.slice(prefix.length) : row.markdown_path;
    entityPathMap.set(row.external_id, rel.endsWith(".md") ? rel.slice(0, -3) : rel);
  }

  const data = typeof entity.data === "string" ? JSON.parse(entity.data) : entity.data;

  return {
    entity: {
      externalId: entity.external_id,
      entityType: entity.entity_type,
      title: entity.title,
      data,
      url: entity.url ?? undefined,
      tags,
    },
    collectionName,
    crawlerType,
    lookupEntityPath: (externalId) => entityPathMap.get(externalId),
  };
}

const api = new Hono<{ Bindings: Env }>();

// GET /api/collections
api.get("/api/collections", async (c) => {
  const collections = await getCollections(c.env.DB);
  const result = await Promise.all(
    collections.map(async (col) => ({
      name: col.name,
      title: col.title || col.name,
      entityCount: await getEntityCount(c.env.DB, col.name),
    })),
  );
  return c.json(result);
});

// GET /api/collections/:name/html-support
api.get("/api/collections/:name/html-support", async (c) => {
  const name = c.req.param("name");
  const col = await getCollection(c.env.DB, name);
  if (!col?.crawler_type) return c.json({ supported: false });
  return c.json({ supported: themeEngine.hasHtmlRenderer(col.crawler_type) });
});

// GET /api/collections/:name/html/*
api.get("/api/collections/:name/html/*", async (c) => {
  const name = c.req.param("name");
  const col = await getCollection(c.env.DB, name);
  if (!col?.crawler_type || !themeEngine.hasHtmlRenderer(col.crawler_type)) {
    return c.text("HTML not supported for this collection", 404);
  }

  const filePath = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/html/`, "");
  const decoded = decodeURIComponent(filePath);

  const entity = await getEntityByMarkdownPath(c.env.DB, name, decoded);
  if (!entity) return c.text("Entity not found", 404);

  const ctx = await buildRenderContext(c.env.DB, name, col.crawler_type, entity);
  const html = themeEngine.renderHtml(ctx);
  if (!html) return c.text("HTML rendering failed", 500);

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

// GET /api/collections/:name/tree
api.get("/api/collections/:name/tree", async (c) => {
  const name = c.req.param("name");
  const col = await getCollection(c.env.DB, name);

  const { results } = await c.env.DB.prepare(
    "SELECT markdown_path, title FROM entities WHERE collection_name = ? AND markdown_path IS NOT NULL",
  ).bind(name).all<{ markdown_path: string; title: string }>();

  const titleByPath = new Map<string, string>();
  const contentPrefix = "content/";
  const mdPaths = (results ?? [])
    .map((row) => {
      const rel = row.markdown_path.startsWith(contentPrefix)
        ? row.markdown_path.slice(contentPrefix.length)
        : row.markdown_path;
      if (row.title) titleByPath.set(rel, row.title);
      return rel;
    })
    .filter((p) => p.endsWith(".md"));

  // Derive folder configs from the theme instead of R2-stored yml files
  const folderConfigs = new Map<string, { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[] }>();
  const rootConfig: { hide?: string[] } = {};
  if (col?.crawler_type) {
    const themeFolderConfigs = themeEngine.getFolderConfigs(col.crawler_type);
    const themeRootConfig = themeEngine.getRootConfig(col.crawler_type);
    if (themeRootConfig.hide) rootConfig.hide = themeRootConfig.hide;

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

  // Apply root-level hide patterns to files at the root (no subdirectory)
  const rootHide = rootConfig.hide ?? [];
  const filteredPaths = mdPaths.filter((p) => {
    const parts = p.split("/");
    if (parts.length === 1 && rootHide.length > 0) {
      return !matchesHidePattern(rootHide, parts[0]);
    }
    return true;
  });

  const tree = buildTreeFromPaths(filteredPaths, titleByPath, folderConfigs);
  return c.json(tree);
});

// GET /api/collections/:name/default-file
api.get("/api/collections/:name/default-file", async (c) => {
  const name = c.req.param("name");
  const entities = await getEntities(c.env.DB, name, { limit: 1 });
  const first = entities[0];
  const filePath = first?.markdown_path?.replace(/^content\//, "") ?? null;
  return c.json({ file: filePath });
});

// GET /api/collections/:name/markdown/*
api.get("/api/collections/:name/markdown/*", async (c) => {
  const name = c.req.param("name");
  const col = await getCollection(c.env.DB, name);
  if (!col?.crawler_type) return c.text("Collection not found", 404);

  const filePath = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/markdown/`, "");
  const decoded = decodeURIComponent(filePath);

  const entity = await getEntityByMarkdownPath(c.env.DB, name, decoded);
  if (!entity) return c.text("File not found", 404);

  const ctx = await buildRenderContext(c.env.DB, name, col.crawler_type, entity);
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

  const rows = await getEntities(c.env.DB, name, { limit, offset, entityType });

  const result = await Promise.all(
    rows.map(async (row) => {
      const tags = await getEntityTags(c.env.DB, name, row.id);
      return {
        id: row.id,
        externalId: row.external_id,
        entityType: row.entity_type,
        title: row.title,
        url: row.url,
        tags,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }),
  );

  return c.json({
    entities: result,
    pagination: { limit, offset, count: result.length },
  });
});

// GET /api/search
api.get("/api/search", async (c) => {
  const query = c.req.query("q");
  if (!query) return c.json({ error: "Missing query parameter 'q'" }, 400);

  const collection = c.req.query("collection") || undefined;
  const entityType = c.req.query("type") || undefined;
  const limit = parseInt(c.req.query("limit") || "20", 10);

  const results = await searchEntities(c.env.DB, query, {
    collectionName: collection,
    entityType,
    limit,
  });

  // Look up markdown paths
  const enriched = await Promise.all(
    results.map(async (r) => {
      const entity = await getEntityByExternalId(c.env.DB, r.collectionName, r.externalId);
      const rawPath = entity?.markdown_path ?? null;
      const markdownPath = rawPath ? rawPath.replace(/^content\//, "") : null;
      return { ...r, title: entity?.title ?? r.title, collection: r.collectionName, markdownPath, snippet: r.snippet };
    }),
  );

  return c.json(enriched);
});

// GET /api/collections/:name/backlinks/:externalId
api.get("/api/collections/:name/backlinks/:externalId", async (c) => {
  const name = c.req.param("name");
  const externalId = decodeURIComponent(c.req.param("externalId"));

  const targetEntity = await getEntityByExternalId(c.env.DB, name, externalId);
  if (!targetEntity) return c.json({ error: "Entity not found" }, 404);

  const links = await getBacklinks(c.env.DB, name, targetEntity.id);

  const results = links.map(({ entity }) => {
    const relPath = entity.markdown_path?.replace(/^content\//, "");
    const displayTitle = relPath
      ? relPath.replace(/\.md$/, "").split("/").pop()!
      : entity.title;
    return {
      entityId: entity.id,
      externalId: entity.external_id,
      entityType: entity.entity_type,
      title: displayTitle,
      markdownPath: entity.markdown_path,
    };
  });

  return c.json(results);
});

// GET /api/collections/:name/outgoing-links/:externalId
api.get("/api/collections/:name/outgoing-links/:externalId", async (c) => {
  const name = c.req.param("name");
  const externalId = decodeURIComponent(c.req.param("externalId"));

  const sourceEntity = await getEntityByExternalId(c.env.DB, name, externalId);
  if (!sourceEntity) return c.json({ error: "Entity not found" }, 404);

  const links = await getOutgoingLinks(c.env.DB, name, sourceEntity.id);

  const results = links
    .filter(({ entity }) => entity !== null)
    .map(({ entity }) => {
      const relPath = entity!.markdown_path
        ? entity!.markdown_path.replace(/^content\//, "")
        : null;
      const displayTitle = relPath
        ? relPath.replace(/\.md$/, "").split("/").pop()!
        : entity!.title;
      return { title: displayTitle, markdownPath: relPath };
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

/** Returns true if `filename` matches any of the glob patterns. */
function matchesHidePattern(patterns: string[], filename: string): boolean {
  return patterns.some((pattern) => {
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

// Helper to build tree from flat file paths, honoring folder yml configs
function buildTreeFromPaths(
  paths: string[],
  titleByPath: Map<string, string> = new Map(),
  folderConfigs: Map<string, { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[] }> = new Map(),
): object[] {
  interface TreeNode {
    name: string;
    path: string;
    type: "directory" | "file";
    title?: string;
    count?: number;
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

  for (const filePath of paths.sort()) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partialPath = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;

      const existing = current.find((n) => n.name === part);
      if (existing && !isFile) {
        current = existing.children!;
      } else if (!existing) {
        const node: TreeNode = isFile
          ? { name: part, path: partialPath, type: "file" }
          : { name: part, path: partialPath, type: "directory", children: [] };
        if (isFile) {
          const title = titleByPath.get(partialPath);
          if (title) node.title = title;
        }
        current.push(node);
        if (!isFile) current = node.children!;
      }
    }
  }

  // Sort: directories first (ASC), files per-folder config (ASC or DESC); prune hidden dirs/files
  function sortTree(nodes: TreeNode[], parentPath: string = ""): TreeNode[] {
    const config = parentPath ? folderConfigs.get(parentPath) : undefined;
    const sortOrder = config?.sort ?? "ASC";
    const folderHide = config?.hide ?? [];

    const dirs = nodes
      .filter((n) => n.type === "directory")
      .filter((n) => {
        const childPath = parentPath ? `${parentPath}/${n.name}` : n.name;
        return folderConfigs.get(childPath)?.visible !== false;
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const files = nodes
      .filter((n) => n.type === "file")
      .filter((n) => folderHide.length === 0 || !matchesHidePattern(folderHide, n.name));
    if (sortOrder === "DESC") {
      files.sort((a, b) => b.name.localeCompare(a.name));
    } else {
      files.sort((a, b) => a.name.localeCompare(b.name));
    }

    for (const dir of dirs) {
      if (dir.children) {
        const childPath = parentPath ? `${parentPath}/${dir.name}` : dir.name;
        dir.children = sortTree(dir.children, childPath);
      }
      dir.count = countFilesInTree(dir.children ?? []);
    }
    return [...dirs, ...files];
  }

  return sortTree(root);
}

export { api };
