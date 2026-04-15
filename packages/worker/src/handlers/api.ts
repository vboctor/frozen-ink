import { Hono } from "hono";
import type { Env } from "../types";
import {
  getEntities,
  getEntityByExternalId,
  getEntityByMarkdownPath,
  getEntityMarkdownPathByExternalId,
  getEntityCount,
  getBacklinks,
  getOutgoingLinks,
  getEntitiesByExternalIds,
  getFullManifest,
  parseEntityTags,
  parseEntityData,
} from "../db/client";
import { getCollections, getCollectionConfig } from "../config";
import { searchEntities } from "../db/search";
import { getR2Object, getMimeType } from "../storage/r2";
import { ThemeEngine } from "@frozenink/core/theme";
import { GitHubTheme, ObsidianTheme, GitTheme, MantisHubTheme } from "@frozenink/crawlers/themes";

const themeEngine = new ThemeEngine();
themeEngine.register(new GitHubTheme());
themeEngine.register(new ObsidianTheme());
themeEngine.register(new GitTheme());
themeEngine.register(new MantisHubTheme());

const api = new Hono<{ Bindings: Env }>();

// GET /api/collections
api.get("/api/collections", async (c) => {
  const collections = await getCollections(c.env.BUCKET);
  const result = await Promise.all(
    collections.map(async (col) => ({
      name: col.name,
      title: col.title || col.name,
      entityCount: await getEntityCount(c.env.DB),
    })),
  );
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

  const entity = await getEntityByMarkdownPath(c.env.DB, decoded);
  if (!entity) return c.text("Entity not found", 404);

  const [tags, allEntities] = await Promise.all([
    Promise.resolve(parseEntityTags(entity)),
    c.env.DB.prepare("SELECT external_id, markdown_path FROM entities WHERE markdown_path IS NOT NULL")
      .all<{ external_id: string; markdown_path: string | null }>()
      .then((r) => r.results ?? []),
  ]);

  const entityPathMap = new Map<string, string>();
  for (const row of allEntities) {
    if (!row.markdown_path) continue;
    entityPathMap.set(row.external_id, row.markdown_path.endsWith(".md") ? row.markdown_path.slice(0, -3) : row.markdown_path);
  }

  const entityData = parseEntityData(entity);
  const source = entityData.source ?? (typeof entity.data === "string" ? JSON.parse(entity.data) : entity.data);

  const html = themeEngine.renderHtml({
    entity: {
      externalId: entity.external_id,
      entityType: entity.entity_type,
      title: entity.title,
      data: source,
      url: entity.url ?? undefined,
      tags,
    },
    collectionName: name,
    crawlerType: col.crawler,
    lookupEntityPath: (externalId) => entityPathMap.get(externalId),
  });
  if (!html) return c.text("HTML rendering failed", 500);

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

// GET /api/collections/:name/tree
api.get("/api/collections/:name/tree", async (c) => {
  const name = c.req.param("name");
  const prefix = `${name}/content/`;

  const rootConfigObj = await c.env.BUCKET.get(`${prefix}content.yml`);
  const rootConfig = rootConfigObj ? parseFolderConfig(await rootConfigObj.text()) : {};
  const rootHide = rootConfig.hide ?? [];

  const listed = await c.env.BUCKET.list({ prefix });
  const mdPaths = listed.objects
    .map((o) => o.key.slice(prefix.length))
    .filter((p) => p.endsWith(".md"))
    .filter((p) => {
      const parts = p.split("/");
      if (parts.length === 1 && rootHide.length > 0) {
        return !matchesHidePattern(rootHide, parts[0]);
      }
      return true;
    });

  const titleByPath = new Map<string, string>();
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT markdown_path, title FROM entities WHERE markdown_path IS NOT NULL AND title IS NOT NULL",
    ).all<{ markdown_path: string; title: string }>();
    for (const row of results ?? []) {
      titleByPath.set(row.markdown_path, row.title);
    }
  } catch {
    // If title lookup fails, fall back to filenames
  }

  const folderPaths = new Set<string>();
  for (const mdPath of mdPaths) {
    const parts = mdPath.split("/");
    for (let i = 1; i < parts.length; i++) {
      folderPaths.add(parts.slice(0, i).join("/"));
    }
  }

  const folderConfigs = new Map<string, { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[] }>();
  await Promise.all(
    [...folderPaths].map(async (folderPath) => {
      const folderName = folderPath.split("/").pop()!;
      const obj = await c.env.BUCKET.get(`${prefix}${folderPath}/${folderName}.yml`);
      if (!obj) return;
      folderConfigs.set(folderPath, parseFolderConfig(await obj.text()));
    }),
  );

  const tree = buildTreeFromPaths(mdPaths, titleByPath, folderConfigs);
  return c.json(tree);
});

// GET /api/collections/:name/default-file
api.get("/api/collections/:name/default-file", async (c) => {
  const name = c.req.param("name");
  const entityList = await getEntities(c.env.DB, { limit: 1 });
  const first = entityList[0];
  const filePath = first?.markdown_path ?? null;
  return c.json({ file: filePath });
});

// GET /api/collections/:name/markdown/*
api.get("/api/collections/:name/markdown/*", async (c) => {
  const name = c.req.param("name");
  const filePath = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/markdown/`, "");
  const decoded = decodeURIComponent(filePath);

  const r2Key = `${name}/content/${decoded}`;
  const obj = await getR2Object(c.env.BUCKET, r2Key);
  if (!obj) return c.text("File not found", 404);

  return new Response(obj.body, {
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

  const result = rows.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    entityType: row.entity_type,
    title: row.title,
    url: row.url,
    tags: parseEntityTags(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return c.json({
    entities: result,
    pagination: { limit, offset, count: result.length },
  });
});

// GET /api/collections/:name/manifest
api.get("/api/collections/:name/manifest", async (c) => {
  const name = c.req.param("name");
  const col = await getCollectionConfig(c.env.BUCKET, name);
  if (!col) return c.json({ error: "Collection not found" }, 404);

  const manifest = await getFullManifest(c.env.DB);
  const entitiesStr = manifest
    .map((e) => `${e.externalId}\t${e.hash}`)
    .join("\n");

  return c.json({
    version: 1,
    capabilities: ["bulk-entities", "html-render"],
    collection: {
      name: col.name,
      title: col.title || col.name,
      crawlerType: col.crawler,
    },
    entities: entitiesStr,
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
      markdownPath: row.markdown_path,
      url: row.url,
      tags: parseEntityTags(row),
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

  const enriched = await Promise.all(
    results.map(async (r) => {
      const entity = await getEntityByExternalId(c.env.DB, r.externalId);
      const markdownPath = entity?.markdown_path ?? null;
      return { ...r, title: entity?.title ?? r.title, collection: collection ?? "", markdownPath, snippet: r.snippet };
    }),
  );

  return c.json(enriched);
});

// GET /api/collections/:name/backlinks/:externalId
api.get("/api/collections/:name/backlinks/:externalId", async (c) => {
  const name = c.req.param("name");
  const externalId = decodeURIComponent(c.req.param("externalId"));

  const targetEntity = await getEntityByExternalId(c.env.DB, externalId);
  if (!targetEntity) return c.json({ error: "Entity not found" }, 404);

  const links = await getBacklinks(c.env.DB, externalId);

  const results = links.map(({ entity }) => {
    const displayTitle = entity.markdown_path
      ? entity.markdown_path.replace(/\.md$/, "").split("/").pop()!
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

  const sourceEntity = await getEntityByExternalId(c.env.DB, externalId);
  if (!sourceEntity) return c.json({ error: "Entity not found" }, 404);

  const links = await getOutgoingLinks(c.env.DB, sourceEntity);

  const results = links
    .filter(({ entity }) => entity !== null)
    .map(({ entity }) => {
      const displayTitle = entity!.markdown_path
        ? entity!.markdown_path.replace(/\.md$/, "").split("/").pop()!
        : entity!.title;
      return { title: displayTitle, markdownPath: entity!.markdown_path };
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

/** Parse a minimal folder yml (visible/sort/hide). Works without js-yaml in the Worker runtime. */
function parseFolderConfig(content: string): { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[] } {
  const config: { visible?: boolean; sort?: "ASC" | "DESC"; hide?: string[] } = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === "visible") config.visible = val.trim() !== "false";
    if (key === "sort") config.sort = val.trim() === "DESC" ? "DESC" : "ASC";
    if (key === "hide") {
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
}

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
