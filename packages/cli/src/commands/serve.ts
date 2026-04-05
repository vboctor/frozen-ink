import { Command } from "commander";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, extname } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  entityTags,
  entityLinks,
  SearchIndexer,
  loadConfig,
} from "@veecontext/core";
import { startStdioServer } from "@veecontext/mcp";
import { eq, desc, like } from "drizzle-orm";

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

function buildFileTree(dirPath: string, basePath: string = ""): object[] {
  if (!existsSync(dirPath)) return [];

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const dirs: object[] = [];
  const files: object[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      dirs.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children: buildFileTree(join(dirPath, entry.name), relativePath),
      });
    } else if (entry.name.endsWith(".md")) {
      files.push({
        name: entry.name,
        path: relativePath,
        type: "file",
      });
    }
  }

  return [...dirs, ...files];
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
  return join(import.meta.dir, "../../../ui/dist");
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
): ReturnType<typeof Bun.serve> {
  const masterDbPath = join(home, "master.db");
  const uiDistDir = resolveUiDistDir();

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // GET /api/collections
      if (path === "/api/collections" && req.method === "GET") {
        const db = getMasterDb(masterDbPath);
        const rows = db.select().from(collections).all();
        const result = rows.map((r) => ({
          name: r.name,
          crawlerType: r.crawlerType,
          enabled: r.enabled,
          syncInterval: r.syncInterval,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
        return jsonResponse(result);
      }

      // GET /api/collections/:name/tree
      const treeMatch = path.match(/^\/api\/collections\/([^/]+)\/tree$/);
      if (treeMatch && req.method === "GET") {
        const name = decodeURIComponent(treeMatch[1]);
        const db = getMasterDb(masterDbPath);
        const [col] = db
          .select()
          .from(collections)
          .where(eq(collections.name, name))
          .all();
        if (!col) return errorResponse("Collection not found", 404);

        const markdownDir = join(home, "collections", name, "markdown");
        const tree = buildFileTree(markdownDir);
        return jsonResponse(tree);
      }

      // GET /api/collections/:name/default-file
      // Returns the most recently updated file in the collection
      const defaultFileMatch = path.match(
        /^\/api\/collections\/([^/]+)\/default-file$/,
      );
      if (defaultFileMatch && req.method === "GET") {
        const name = decodeURIComponent(defaultFileMatch[1]);
        const db = getMasterDb(masterDbPath);
        const [col] = db
          .select()
          .from(collections)
          .where(eq(collections.name, name))
          .all();
        if (!col) return errorResponse("Collection not found", 404);
        if (!existsSync(col.dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(col.dbPath);
        const [latest] = colDb
          .select({ markdownPath: entities.markdownPath })
          .from(entities)
          .orderBy(desc(entities.updatedAt))
          .limit(1)
          .all();

        const filePath = latest?.markdownPath?.replace(/^markdown\//, "") ?? null;
        return jsonResponse({ file: filePath });
      }

      // GET /api/collections/:name/markdown/*path — serve raw markdown file content
      const markdownMatch = path.match(
        /^\/api\/collections\/([^/]+)\/markdown\/(.+)$/,
      );
      if (markdownMatch && req.method === "GET") {
        const name = decodeURIComponent(markdownMatch[1]);
        const filePath = decodeURIComponent(markdownMatch[2]);

        const fullPath = join(home, "collections", name, "markdown", filePath);

        // Prevent path traversal
        const collectionsBase = join(home, "collections", name);
        if (!fullPath.startsWith(collectionsBase)) {
          return errorResponse("Forbidden", 403);
        }

        if (!existsSync(fullPath)) {
          return errorResponse("File not found", 404);
        }

        const content = readFileSync(fullPath, "utf-8");
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      }

      // GET /api/collections/:name/entities
      const entitiesMatch = path.match(
        /^\/api\/collections\/([^/]+)\/entities$/,
      );
      if (entitiesMatch && req.method === "GET") {
        const name = decodeURIComponent(entitiesMatch[1]);
        const db = getMasterDb(masterDbPath);
        const [col] = db
          .select()
          .from(collections)
          .where(eq(collections.name, name))
          .all();
        if (!col) return errorResponse("Collection not found", 404);
        if (!existsSync(col.dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(col.dbPath);
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

        // Get tags for each entity
        const result = rows.map((row) => {
          const tags = colDb
            .select()
            .from(entityTags)
            .where(eq(entityTags.entityId, row.id))
            .all()
            .map((t) => t.tag);
          return {
            id: row.id,
            externalId: row.externalId,
            entityType: row.entityType,
            title: row.title,
            url: row.url,
            tags,
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

        const db = getMasterDb(masterDbPath);
        let collectionRows = db.select().from(collections).all();

        if (collectionFilter) {
          collectionRows = collectionRows.filter(
            (c) => c.name === collectionFilter,
          );
          if (collectionRows.length === 0)
            return errorResponse("Collection not found", 404);
        }

        const allResults: Array<{
          collection: string;
          entityId: number;
          externalId: string;
          entityType: string;
          title: string;
          markdownPath: string | null;
          rank: number;
        }> = [];

        for (const col of collectionRows) {
          if (!existsSync(col.dbPath)) continue;

          const colDb = getCollectionDb(col.dbPath);
          const indexer = new SearchIndexer(col.dbPath);
          try {
            const results = indexer.search(query, {
              entityType: typeFilter || undefined,
            });
            for (const r of results) {
              // Look up markdownPath from entities table
              const [entity] = colDb
                .select({ markdownPath: entities.markdownPath })
                .from(entities)
                .where(eq(entities.id, r.entityId))
                .all();
              // Strip the "markdown/" base path prefix so the UI receives a path
              // relative to the markdown directory (matching what the file tree returns)
              const rawPath = entity?.markdownPath ?? null;
              const markdownPath = rawPath ? rawPath.replace(/^markdown\//, "") : null;
              allResults.push({
                ...r,
                collection: col.name,
                markdownPath,
              });
            }
          } finally {
            indexer.close();
          }
        }

        allResults.sort((a, b) => a.rank - b.rank);
        return jsonResponse(allResults.slice(0, limit));
      }

      // GET /api/collections/:name/backlinks/*targetPath
      // Returns all entities whose markdown links to the given target path
      const backlinksMatch = path.match(
        /^\/api\/collections\/([^/]+)\/backlinks\/(.+)$/,
      );
      if (backlinksMatch && req.method === "GET") {
        const name = decodeURIComponent(backlinksMatch[1]);
        const targetFile = decodeURIComponent(backlinksMatch[2]);

        const db = getMasterDb(masterDbPath);
        const [col] = db
          .select()
          .from(collections)
          .where(eq(collections.name, name))
          .all();
        if (!col) return errorResponse("Collection not found", 404);
        if (!existsSync(col.dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(col.dbPath);

        // The UI passes the file path relative to the markdown dir (e.g. "issues/42.md").
        // Links in the DB store the full path including the base dir (e.g. "markdown/issues/42.md").
        const targetVariants = [targetFile, `markdown/${targetFile}`];

        // Also match without .md extension since wikilinks resolve to path + ".md"
        if (!targetFile.endsWith(".md")) {
          targetVariants.push(`${targetFile}.md`, `markdown/${targetFile}.md`);
        }

        // Obsidian-style: wikilinks like [[VeeClaw - Use Cases]] store the stem without
        // the folder prefix (e.g. "markdown/VeeClaw - Use Cases.md") even when the actual
        // file lives in a subdirectory ("Projects/VeeClaw - Use Cases.md").
        // Add filename-only variants to catch those cross-folder backlinks.
        const filename = targetFile.includes("/") ? targetFile.split("/").pop()! : null;
        if (filename) {
          targetVariants.push(filename, `markdown/${filename}`);
          if (!filename.endsWith(".md")) {
            targetVariants.push(`${filename}.md`, `markdown/${filename}.md`);
          }
        }

        const seen = new Set<number>();
        const results: Array<{
          entityId: number;
          externalId: string;
          entityType: string;
          title: string;
          markdownPath: string | null;
        }> = [];

        for (const variant of targetVariants) {
          const linkRows = colDb
            .select()
            .from(entityLinks)
            .where(eq(entityLinks.targetPath, variant))
            .all();

          for (const link of linkRows) {
            if (seen.has(link.sourceEntityId)) continue;
            seen.add(link.sourceEntityId);

            const [entity] = colDb
              .select()
              .from(entities)
              .where(eq(entities.id, link.sourceEntityId))
              .all();

            if (entity) {
              // Use filename stem as title (more reliable than entity.title which
              // can match H1 headings inside code blocks)
              const relPath = entity.markdownPath?.replace(/^markdown\//, "");
              const displayTitle = relPath
                ? relPath.replace(/\.md$/, "").split("/").pop()!
                : entity.title;
              results.push({
                entityId: entity.id,
                externalId: entity.externalId,
                entityType: entity.entityType,
                title: displayTitle,
                markdownPath: entity.markdownPath,
              });
            }
          }
        }

        return jsonResponse(results);
      }

      // GET /api/collections/:name/outgoing-links/*sourcePath
      // Returns all entities that the given file links to
      const outgoingMatch = path.match(
        /^\/api\/collections\/([^/]+)\/outgoing-links\/(.+)$/,
      );
      if (outgoingMatch && req.method === "GET") {
        const name = decodeURIComponent(outgoingMatch[1]);
        const sourceFile = decodeURIComponent(outgoingMatch[2]);

        const db = getMasterDb(masterDbPath);
        const [col] = db.select().from(collections).where(eq(collections.name, name)).all();
        if (!col) return errorResponse("Collection not found", 404);
        if (!existsSync(col.dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(col.dbPath);

        // sourceMarkdownPath in DB includes the "markdown/" prefix
        const sourceVariants = [sourceFile, `markdown/${sourceFile}`];

        const seen = new Set<string>();
        const results: Array<{
          title: string;
          markdownPath: string | null;
        }> = [];

        for (const variant of sourceVariants) {
          const linkRows = colDb
            .select()
            .from(entityLinks)
            .where(eq(entityLinks.sourceMarkdownPath, variant))
            .all();

          for (const link of linkRows) {
            if (seen.has(link.targetPath)) continue;
            seen.add(link.targetPath);

            // targetPath is already stored as "markdown/{target}.md" by syncLinks().
            // Entity markdownPath may include subfolders: "markdown/VeeClaw/VeeClaw - Design.md".
            // 1. Direct match (works when target has no subfolder mismatch)
            let entity = null;
            const [e1] = colDb
              .select()
              .from(entities)
              .where(eq(entities.markdownPath, link.targetPath))
              .all();
            if (e1) { entity = e1; }

            // 2. Stem match by filename (Obsidian resolves wikilinks by filename alone)
            if (!entity) {
              const filename = link.targetPath.split("/").pop();
              if (filename) {
                const [e2] = colDb
                  .select()
                  .from(entities)
                  .where(like(entities.markdownPath, `%/${filename}`))
                  .all();
                if (e2) { entity = e2; }
              }
            }

            if (entity) {
              const relPath = entity.markdownPath
                ? entity.markdownPath.replace(/^markdown\//, "")
                : null;
              // Use filename stem as title (more reliable than entity.title which
              // can match H1 headings inside code blocks)
              const displayTitle = relPath
                ? relPath.replace(/\.md$/, "").split("/").pop()!
                : entity.title;
              results.push({ title: displayTitle, markdownPath: relPath });
            }
            // Dangling links (no matching entity) are silently excluded
          }
        }

        results.sort((a, b) => a.title.localeCompare(b.title));
        return jsonResponse(results);
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

      // Serve static UI files for non-API routes
      if (!path.startsWith("/api/")) {
        const staticResponse = tryServeStatic(uiDistDir, path);
        if (staticResponse) return staticResponse;
      }

      return errorResponse("Not found", 404);
    },
  });

  return server;
}

export const serveCommand = new Command("serve")
  .description("Start the API and/or MCP server")
  .option("--mcp-only", "Start only the MCP server (no REST API)")
  .option("--ui-only", "Start only the REST API server (no MCP)")
  .option("--port <port>", "Port for the REST API server")
  .action(async (opts: { mcpOnly?: boolean; uiOnly?: boolean; port?: string }) => {
    const home = getVeeContextHome();
    const masterDbPath = join(home, "master.db");

    if (!existsSync(masterDbPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const config = loadConfig();
    const port = opts.port ? parseInt(opts.port, 10) : config.ui.port;

    if (opts.mcpOnly) {
      console.error("Starting VeeContext MCP server (STDIO)...");
      await startStdioServer({ veecontextHome: home });
      return;
    }

    if (opts.uiOnly) {
      const server = createApiServer(home, port);
      console.log(`VeeContext API server running on http://localhost:${server.port}`);
      return;
    }

    // Start both
    const server = createApiServer(home, port);
    console.log(`VeeContext API server running on http://localhost:${server.port}`);
    console.error("Starting VeeContext MCP server (STDIO)...");
    await startStdioServer({ veecontextHome: home });
  });
