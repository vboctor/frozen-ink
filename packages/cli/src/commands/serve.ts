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
  entityTags,
  tags,
  links,
  assets,
  SearchIndexer,
  ThemeEngine,
  loadConfig,
  getModuleDir,
  isBun,
  resolveUiDist,
} from "@frozenink/core";
import {
  gitHubTheme,
  obsidianTheme,
  gitTheme,
  mantisHubTheme,
} from "@frozenink/crawlers";
import { startStdioServer } from "@frozenink/mcp";
import { eq, desc } from "drizzle-orm";
import { handleManagementRequest, setAppMode } from "./management-api";
import { prepareCollections } from "./prepare";

const __moduleDir = getModuleDir(import.meta.url);

function createThemeEngine(): ThemeEngine {
  const themeEngine = new ThemeEngine();
  themeEngine.register(gitHubTheme);
  themeEngine.register(obsidianTheme);
  themeEngine.register(gitTheme);
  themeEngine.register(mantisHubTheme);
  return themeEngine;
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

/** Parse a folder yml file (visible/sort fields only). */
function readFolderConfig(dirPath: string): { visible?: boolean; sort?: "ASC" | "DESC" } {
  const folderName = basename(dirPath);
  const ymlPath = join(dirPath, `${folderName}.yml`);
  if (!existsSync(ymlPath)) return {};
  try {
    const content = readFileSync(ymlPath, "utf-8");
    const config: { visible?: boolean; sort?: "ASC" | "DESC" } = {};
    for (const line of content.split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (key === "visible") config.visible = val.trim() !== "false";
      if (key === "sort") config.sort = val.trim() === "DESC" ? "DESC" : "ASC";
    }
    return config;
  } catch {
    return {};
  }
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
): object[] {
  if (!existsSync(dirPath)) return [];

  // Read this directory's own config to determine sort order for its files
  const ownConfig = basePath ? readFolderConfig(dirPath) : {};
  const sortOrder = ownConfig.sort ?? "ASC";

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const dirs: object[] = [];
  const files: object[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const childDirPath = join(dirPath, entry.name);
      // Check child dir's visibility before including it
      const childConfig = readFolderConfig(childDirPath);
      if (childConfig.visible === false) continue;
      const children = buildFileTree(childDirPath, titleByPath, relativePath);
      dirs.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        count: countFiles(children),
        children,
      });
    } else if (entry.name.endsWith(".md")) {
      const node: Record<string, unknown> = {
        name: entry.name,
        path: relativePath,
        type: "file",
      };
      const title = titleByPath.get(relativePath);
      if (title) node.title = title;
      files.push(node);
    }
  }

  // Apply sort order to files (dirs always sort ASC alphabetically)
  const sortedFiles = sortOrder === "DESC" ? files.slice().reverse() : files;
  return [...dirs, ...sortedFiles];
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
        const rows = listCollections();
        const result = rows.map((r) => ({
          name: r.name,
          title: r.title ?? r.name,
          description: r.description,
          crawlerType: r.crawler,
          enabled: r.enabled,
          syncInterval: r.syncInterval,
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

        // Build a map from relative content path → entity title
        const titleByPath = new Map<string, string>();
        const dbPath = getCollectionDbPath(name);
        if (existsSync(dbPath)) {
          const colDb = getCollectionDb(dbPath);
          const rows = colDb
            .select({ markdownPath: entities.markdownPath, title: entities.title })
            .from(entities)
            .all();
          const prefix = "content/";
          for (const row of rows) {
            if (!row.markdownPath || !row.title) continue;
            const rel = row.markdownPath.startsWith(prefix)
              ? row.markdownPath.slice(prefix.length)
              : row.markdownPath;
            titleByPath.set(rel, row.title);
          }
        }

        const tree = buildFileTree(contentDir, titleByPath);
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
        const [latest] = colDb
          .select({ markdownPath: entities.markdownPath })
          .from(entities)
          .orderBy(desc(entities.updatedAt))
          .limit(1)
          .all();

        const filePath = latest?.markdownPath?.replace(/^content\//, "") ?? null;
        return jsonResponse({ file: filePath });
      }

      // GET /api/collections/:name/markdown/*path
      const markdownMatch = path.match(
        /^\/api\/collections\/([^/]+)\/markdown\/(.+)$/,
      );
      if (markdownMatch && req.method === "GET") {
        const name = decodeURIComponent(markdownMatch[1]);
        const filePath = decodeURIComponent(markdownMatch[2]);

        const fullPath = join(home, "collections", name, "content", filePath);

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

      // GET /api/collections/:name/html/*path — render entity as styled HTML
      const htmlMatch = path.match(
        /^\/api\/collections\/([^/]+)\/html\/(.+)$/,
      );
      if (htmlMatch && req.method === "GET") {
        const name = decodeURIComponent(htmlMatch[1]);
        const filePath = decodeURIComponent(htmlMatch[2]);
        const col = getCollection(name);
        if (!col) return errorResponse("Collection not found", 404);

        if (!themeEngine.hasHtmlRenderer(col.crawler)) {
          return errorResponse("HTML rendering not supported for this crawler", 404);
        }

        const dbPath = getCollectionDbPath(name);
        if (!existsSync(dbPath))
          return errorResponse("Collection database not found", 404);

        const colDb = getCollectionDb(dbPath);

        // Look up entity by markdown_path (try with and without content/ prefix)
        const pathVariants = [`content/${filePath}`, filePath];
        let entity = null;
        for (const variant of pathVariants) {
          const [row] = colDb
            .select()
            .from(entities)
            .where(eq(entities.markdownPath, variant))
            .all();
          if (row) { entity = row; break; }
        }

        if (!entity) return errorResponse("Entity not found", 404);

        // Get tags (join entityTags -> tags)
        const entityTagNames = colDb
          .select()
          .from(entityTags)
          .where(eq(entityTags.entityId, entity.id))
          .all()
          .map((t: any) => {
            const [tagRow] = colDb.select().from(tags).where(eq(tags.id, t.tagId)).all();
            return tagRow?.name ?? "";
          })
          .filter(Boolean);

        const data = typeof entity.data === "string"
          ? JSON.parse(entity.data)
          : entity.data;

        // Build entity path lookup for resolving cross-references (e.g. user pages)
        const lookupEntityPath = (externalId: string): string | undefined => {
          const [row] = colDb
            .select({ markdownPath: entities.markdownPath })
            .from(entities)
            .where(eq(entities.externalId, externalId))
            .all();
          const mdPath = row?.markdownPath;
          if (!mdPath) return undefined;
          const prefix = "content/";
          const relative = mdPath.startsWith(prefix) ? mdPath.slice(prefix.length) : mdPath;
          return relative.endsWith(".md") ? relative.slice(0, -3) : relative;
        };

        const html = themeEngine.renderHtml({
          entity: {
            externalId: entity.externalId,
            entityType: entity.entityType,
            title: entity.title,
            data,
            url: entity.url ?? undefined,
            tags: entityTagNames,
          },
          collectionName: name,
          crawlerType: col.crawler,
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
        return jsonResponse({ supported: themeEngine.hasHtmlRenderer(col.crawler) });
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

        // Get tags for each entity (join entityTags -> tags)
        const result = rows.map((row: any) => {
          const rowTags = colDb
            .select()
            .from(entityTags)
            .where(eq(entityTags.entityId, row.id))
            .all()
            .map((t: any) => {
              const [tagRow] = colDb.select().from(tags).where(eq(tags.id, t.tagId)).all();
              return tagRow?.name ?? "";
            })
            .filter(Boolean);
          return {
            id: row.id,
            externalId: row.externalId,
            entityType: row.entityType,
            title: row.title,
            url: row.url,
            tags: rowTags,
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
          const indexer = new SearchIndexer(dbPath);
          try {
            const results = indexer.search(query, {
              entityType: typeFilter || undefined,
            });
            for (const r of results) {
              const [entity] = colDb
                .select({ markdownPath: entities.markdownPath, title: entities.title })
                .from(entities)
                .where(eq(entities.id, r.entityId))
                .all();
              const rawPath = entity?.markdownPath ?? null;
              const markdownPath = rawPath ? rawPath.replace(/^content\//, "") : null;
              allResults.push({
                ...r,
                title: entity?.title ?? r.title,
                collection: col.name,
                markdownPath,
                snippet: r.snippet,
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

        // Find the target entity by markdown path variants
        const targetVariants = [targetFile, `content/${targetFile}`];
        if (!targetFile.endsWith(".md")) {
          targetVariants.push(`${targetFile}.md`, `content/${targetFile}.md`);
        }
        const filename = targetFile.includes("/") ? targetFile.split("/").pop()! : null;
        if (filename) {
          targetVariants.push(filename, `content/${filename}`);
          if (!filename.endsWith(".md")) {
            targetVariants.push(`${filename}.md`, `content/${filename}.md`);
          }
        }

        // Resolve target entity IDs from markdown path variants
        const targetEntityIds = new Set<number>();
        for (const variant of targetVariants) {
          const rows = colDb
            .select({ id: entities.id })
            .from(entities)
            .where(eq(entities.markdownPath, variant))
            .all();
          for (const row of rows) targetEntityIds.add(row.id);
        }

        const seen = new Set<number>();
        const results: Array<{
          entityId: number;
          externalId: string;
          entityType: string;
          title: string;
          markdownPath: string | null;
        }> = [];

        for (const targetEntityId of targetEntityIds) {
          const linkRows = colDb
            .select()
            .from(links)
            .where(eq(links.targetEntityId, targetEntityId))
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
              const relPath = entity.markdownPath?.replace(/^content\//, "");
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

        // Find source entity by markdown path variants
        const sourceVariants = [sourceFile, `content/${sourceFile}`];

        // Resolve source entity IDs
        const sourceEntityIds = new Set<number>();
        for (const variant of sourceVariants) {
          const rows = colDb
            .select({ id: entities.id })
            .from(entities)
            .where(eq(entities.markdownPath, variant))
            .all();
          for (const row of rows) sourceEntityIds.add(row.id);
        }

        const seen = new Set<number>();
        const results: Array<{
          title: string;
          markdownPath: string | null;
        }> = [];

        for (const sourceEntityId of sourceEntityIds) {
          const linkRows = colDb
            .select()
            .from(links)
            .where(eq(links.sourceEntityId, sourceEntityId))
            .all();

          for (const link of linkRows) {
            if (seen.has(link.targetEntityId)) continue;
            seen.add(link.targetEntityId);

            const [entity] = colDb
              .select()
              .from(entities)
              .where(eq(entities.id, link.targetEntityId))
              .all();

            if (entity) {
              const relPath = entity.markdownPath
                ? entity.markdownPath.replace(/^content\//, "")
                : null;
              const displayTitle = relPath
                ? relPath.replace(/\.md$/, "").split("/").pop()!
                : entity.title;
              results.push({ title: displayTitle, markdownPath: relPath });
            }
          }
        }

        results.sort((a, b) => a.title.localeCompare(b.title));
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
  .option("--mcp-only", "Start only the MCP server (no REST API)")
  .option("--ui-only", "Start only the REST API server (no MCP)")
  .option("--port <port>", "Port for the REST API server")
  .action(async (opts: { mcpOnly?: boolean; uiOnly?: boolean; port?: string }) => {
    const home = getFrozenInkHome();

    ensureInitialized();

    const config = loadConfig();
    const port = opts.port ? parseInt(opts.port, 10) : config.ui.port;

    await prepareCollections(home);

    if (opts.mcpOnly) {
      console.error("Starting Frozen Ink MCP server (STDIO)...");
      await startStdioServer({ frozeninkHome: home });
      return;
    }

    if (opts.uiOnly) {
      const server = await Promise.resolve(createApiServer(home, port));
      console.log(`Frozen Ink API server running on http://localhost:${server.port}`);
      return;
    }

    // Start both
    const server = await Promise.resolve(createApiServer(home, port));
    console.log(`Frozen Ink API server running on http://localhost:${server.port}`);
    console.error("Starting Frozen Ink MCP server (STDIO)...");
    await startStdioServer({ frozeninkHome: home });
  });
