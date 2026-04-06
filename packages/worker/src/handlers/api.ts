import { Hono } from "hono";
import type { Env } from "../types";
import {
  getCollections,
  getEntities,
  getEntityByExternalId,
  getEntityTags,
  getEntityCount,
  getBacklinks,
  getOutgoingLinks,
} from "../db/client";
import { searchEntities } from "../db/search";
import { getR2Object, getMimeType } from "../storage/r2";

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

// GET /api/collections/:name/tree
api.get("/api/collections/:name/tree", async (c) => {
  const name = c.req.param("name");
  const prefix = `${name}/markdown/`;

  const listed = await c.env.BUCKET.list({ prefix });
  const paths = listed.objects.map((o) => o.key.slice(prefix.length)).filter((p) => p.endsWith(".md"));

  // Build tree from paths
  const tree = buildTreeFromPaths(paths);
  return c.json(tree);
});

// GET /api/collections/:name/default-file
api.get("/api/collections/:name/default-file", async (c) => {
  const name = c.req.param("name");
  const entities = await getEntities(c.env.DB, name, { limit: 1 });
  const first = entities[0];
  const filePath = first?.markdown_path?.replace(/^markdown\//, "") ?? null;
  return c.json({ file: filePath });
});

// GET /api/collections/:name/markdown/*
api.get("/api/collections/:name/markdown/*", async (c) => {
  const name = c.req.param("name");
  const filePath = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/markdown/`, "");
  const decoded = decodeURIComponent(filePath);

  const r2Key = `${name}/markdown/${decoded}`;
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
      const markdownPath = rawPath ? rawPath.replace(/^markdown\//, "") : null;
      return { ...r, collection: r.collectionName, markdownPath };
    }),
  );

  return c.json(enriched);
});

// GET /api/collections/:name/backlinks/*
api.get("/api/collections/:name/backlinks/*", async (c) => {
  const name = c.req.param("name");
  const targetFile = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/backlinks/`, "");
  const decoded = decodeURIComponent(targetFile);

  const links = await getBacklinks(c.env.DB, name, decoded);

  const results = links.map(({ entity }) => {
    const relPath = entity.markdown_path?.replace(/^markdown\//, "");
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

// GET /api/collections/:name/outgoing-links/*
api.get("/api/collections/:name/outgoing-links/*", async (c) => {
  const name = c.req.param("name");
  const sourceFile = c.req.path.replace(`/api/collections/${encodeURIComponent(name)}/outgoing-links/`, "");
  const decoded = decodeURIComponent(sourceFile);

  const links = await getOutgoingLinks(c.env.DB, name, decoded);

  const results = links
    .filter(({ entity }) => entity !== null)
    .map(({ entity }) => {
      const relPath = entity!.markdown_path
        ? entity!.markdown_path.replace(/^markdown\//, "")
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

// Helper to build tree from flat file paths
function buildTreeFromPaths(paths: string[]): object[] {
  interface TreeNode {
    name: string;
    path: string;
    type: "directory" | "file";
    children?: TreeNode[];
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
        current.push(node);
        if (!isFile) current = node.children!;
      }
    }
  }

  // Sort: directories first, then files, alphabetical within each
  function sortTree(nodes: TreeNode[]): TreeNode[] {
    const dirs = nodes.filter((n) => n.type === "directory").sort((a, b) => a.name.localeCompare(b.name));
    const files = nodes.filter((n) => n.type === "file").sort((a, b) => a.name.localeCompare(b.name));
    for (const dir of dirs) {
      if (dir.children) dir.children = sortTree(dir.children);
    }
    return [...dirs, ...files];
  }

  return sortTree(root);
}

export { api };
