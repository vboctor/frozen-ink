import { Command } from "commander";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, extname, relative } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  entityTags,
  attachments,
  SearchIndexer,
  loadConfig,
} from "@veecontext/core";
import { startStdioServer } from "@veecontext/mcp";
import { eq, like, desc, asc } from "drizzle-orm";

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
  const result: object[] = [];
  if (!existsSync(dirPath)) return result;

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children: buildFileTree(join(dirPath, entry.name), relativePath),
      });
    } else if (entry.name.endsWith(".md")) {
      result.push({
        name: entry.name,
        path: relativePath,
        type: "file",
      });
    }
  }
  return result;
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

export function createApiServer(
  home: string,
  port: number,
): ReturnType<typeof Bun.serve> {
  const masterDbPath = join(home, "master.db");

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
          connectorType: r.connectorType,
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
          rank: number;
        }> = [];

        for (const col of collectionRows) {
          if (!existsSync(col.dbPath)) continue;

          const indexer = new SearchIndexer(col.dbPath);
          try {
            const results = indexer.search(query, {
              entityType: typeFilter || undefined,
            });
            for (const r of results) {
              allResults.push({ ...r, collection: col.name });
            }
          } finally {
            indexer.close();
          }
        }

        allResults.sort((a, b) => a.rank - b.rank);
        return jsonResponse(allResults.slice(0, limit));
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
