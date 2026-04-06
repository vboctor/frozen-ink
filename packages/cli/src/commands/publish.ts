import { Command } from "commander";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import {
  getVeeContextHome,
  getCollectionDb,
  contextExists,
  getCollection,
  getCollectionDbPath,
  addDeployment,
  getDeployment,
  entities,
  entityTags,
  entityLinks,
  attachments,
} from "@veecontext/core";
import { eq } from "drizzle-orm";
import {
  checkWranglerAuth,
  createD1,
  executeD1File,
  executeD1Command,
  createR2Bucket,
  putR2Object,
  deleteR2Object,
  deployWorker,
  generateWranglerToml,
  writeTempFile,
  cleanupTempFile,
} from "./wrangler-api";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function escapeSQL(str: string): string {
  return str.replace(/'/g, "''");
}

function collectFiles(dir: string, base: string = ""): Array<{ relativePath: string; fullPath: string }> {
  if (!existsSync(dir)) return [];
  const files: Array<{ relativePath: string; fullPath: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, relPath));
    } else {
      files.push({ relativePath: relPath, fullPath });
    }
  }
  return files;
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".pdf": "application/pdf", ".json": "application/json",
  ".md": "text/markdown", ".txt": "text/plain", ".html": "text/html",
  ".css": "text/css", ".js": "application/javascript", ".ico": "image/x-icon",
};

function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

export const publishCommand = new Command("publish")
  .description("Publish collections to Cloudflare as a password-protected website with MCP access")
  .argument("<collections...>", "Collection names to publish")
  .option("--password <password>", "Password to protect access")
  .option("--name <name>", "Worker name (default: vctx-<first-collection>-<random>)")
  .action(async (collectionNames: string[], opts: {
    password?: string;
    name?: string;
  }) => {
    try {
    if (!contextExists()) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    // Step 0: Check wrangler auth
    await checkWranglerAuth();

    // Validate collections
    const home = getVeeContextHome();
    for (const name of collectionNames) {
      const col = getCollection(name);
      if (!col) {
        console.error(`Collection "${name}" not found`);
        process.exit(1);
      }
      const dbPath = getCollectionDbPath(name);
      if (!existsSync(dbPath)) {
        console.error(`Collection "${name}" database not found at ${dbPath}`);
        process.exit(1);
      }
    }

    const workerName = opts.name || `vctx-${collectionNames[0]}-${randomSuffix()}`;
    const d1DatabaseName = `${workerName}-db`;
    const r2BucketName = `${workerName}-files`;

    // Check if this is an update to an existing deployment
    const existingDeployment = getDeployment(workerName);
    const isUpdate = !!existingDeployment;

    // Hash password
    let passwordHash = "";
    if (opts.password) {
      const salt = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const data = new TextEncoder().encode(salt + opts.password);
      const hashBuf = await crypto.subtle.digest("SHA-256", data);
      const hashHex = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      passwordHash = `${salt}:${hashHex}`;
    }

    console.log(`${isUpdate ? "Updating" : "Publishing"} ${collectionNames.length} collection(s) as "${workerName}"...`);

    // Step 1: Create or reuse D1 database
    console.log("  Setting up D1 database...");
    const d1 = await createD1(d1DatabaseName);
    const d1DatabaseId = d1.uuid;
    console.log(`  D1 database: ${d1DatabaseName} (${d1DatabaseId})`);

    // D1 has a per-statement size limit (~100KB). We split the SQL into:
    //   1. Schema DDL + entity/tag/link/attachment data (small per-row)
    //   2. FTS content (can be large — truncate and batch separately)

    // --- Batch 1: Schema + structured data ---
    console.log("  Building database export...");
    const schemaSql: string[] = [];

    schemaSql.push("DROP TABLE IF EXISTS entities_fts;");
    schemaSql.push("DROP TABLE IF EXISTS r2_manifest;");
    schemaSql.push("DROP TABLE IF EXISTS entity_links;");
    schemaSql.push("DROP TABLE IF EXISTS entity_tags;");
    schemaSql.push("DROP TABLE IF EXISTS attachments;");
    schemaSql.push("DROP TABLE IF EXISTS entities;");
    schemaSql.push("DROP TABLE IF EXISTS collections_meta;");
    schemaSql.push("");
    schemaSql.push("CREATE TABLE collections_meta (name TEXT PRIMARY KEY, title TEXT);");
    schemaSql.push(`CREATE TABLE entities (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  external_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  title TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  markdown_path TEXT, url TEXT, created_at TEXT, updated_at TEXT
);`);
    schemaSql.push("CREATE INDEX idx_entities_collection ON entities(collection_name);");
    schemaSql.push("CREATE INDEX idx_entities_external ON entities(collection_name, external_id);");
    schemaSql.push(`CREATE TABLE entity_tags (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  entity_id INTEGER NOT NULL, tag TEXT NOT NULL
);`);
    schemaSql.push(`CREATE TABLE entity_links (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  source_entity_id INTEGER NOT NULL,
  source_markdown_path TEXT NOT NULL, target_path TEXT NOT NULL
);`);
    schemaSql.push("CREATE INDEX idx_links_target ON entity_links(target_path);");
    schemaSql.push("CREATE INDEX idx_links_source ON entity_links(source_markdown_path);");
    schemaSql.push(`CREATE TABLE attachments (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  entity_id INTEGER NOT NULL, filename TEXT NOT NULL,
  mime_type TEXT NOT NULL, storage_path TEXT NOT NULL
);`);
    schemaSql.push("CREATE TABLE r2_manifest (key TEXT PRIMARY KEY);");
    schemaSql.push("");

    // Export data from each collection
    let entityIdOffset = 0;
    // D1 per-statement limit is ~100KB. Truncate large entity data to stay safe.
    const MAX_DATA_LEN = 50000;

    for (const colName of collectionNames) {
      const col = getCollection(colName)!;
      const dbPath = getCollectionDbPath(colName);
      const colDb = getCollectionDb(dbPath);
      const title = col.title || colName;

      schemaSql.push(`INSERT INTO collections_meta (name, title) VALUES ('${escapeSQL(colName)}', '${escapeSQL(title)}');`);

      const allEntities = colDb.select().from(entities).all();
      const entityIdMap = new Map<number, number>();

      for (const entity of allEntities) {
        entityIdOffset++;
        entityIdMap.set(entity.id, entityIdOffset);
        let data = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);
        if (data.length > MAX_DATA_LEN) data = data.slice(0, MAX_DATA_LEN);

        schemaSql.push(`INSERT INTO entities (id, collection_name, external_id, entity_type, title, data, markdown_path, url, created_at, updated_at) VALUES (${entityIdOffset}, '${escapeSQL(colName)}', '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(data)}', ${entity.markdownPath ? `'${escapeSQL(entity.markdownPath)}'` : "NULL"}, ${entity.url ? `'${escapeSQL(entity.url)}'` : "NULL"}, ${entity.createdAt ? `'${escapeSQL(entity.createdAt)}'` : "NULL"}, ${entity.updatedAt ? `'${escapeSQL(entity.updatedAt)}'` : "NULL"});`);
      }

      for (const tag of colDb.select().from(entityTags).all()) {
        const remoteId = entityIdMap.get(tag.entityId);
        if (!remoteId) continue;
        schemaSql.push(`INSERT INTO entity_tags (collection_name, entity_id, tag) VALUES ('${escapeSQL(colName)}', ${remoteId}, '${escapeSQL(tag.tag)}');`);
      }

      for (const link of colDb.select().from(entityLinks).all()) {
        const remoteId = entityIdMap.get(link.sourceEntityId);
        if (!remoteId) continue;
        schemaSql.push(`INSERT INTO entity_links (collection_name, source_entity_id, source_markdown_path, target_path) VALUES ('${escapeSQL(colName)}', ${remoteId}, '${escapeSQL(link.sourceMarkdownPath)}', '${escapeSQL(link.targetPath)}');`);
      }

      for (const att of colDb.select().from(attachments).all()) {
        const remoteId = entityIdMap.get(att.entityId);
        if (!remoteId) continue;
        schemaSql.push(`INSERT INTO attachments (collection_name, entity_id, filename, mime_type, storage_path) VALUES ('${escapeSQL(colName)}', ${remoteId}, '${escapeSQL(att.filename)}', '${escapeSQL(att.mimeType)}', '${escapeSQL(att.storagePath)}');`);
      }

      console.log(`  Exported "${colName}": ${allEntities.length} entities`);
    }

    // Step 3a: Execute schema + data
    console.log("  Uploading schema and data to D1...");
    const schemaFile = writeTempFile(schemaSql.join("\n"), ".sql");
    try {
      await executeD1File(d1DatabaseName, schemaFile);
    } finally {
      cleanupTempFile(schemaFile);
    }

    // --- Batch 2: FTS5 index (separate because content can be large) ---
    console.log("  Building search index...");
    const MAX_FTS_CONTENT = 8000; // Truncate FTS content to keep statements under D1 limit
    const ftsSql: string[] = [];
    ftsSql.push("CREATE VIRTUAL TABLE entities_fts USING fts5(collection_name UNINDEXED, entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags);");

    for (const colName of collectionNames) {
      const dbPath = getCollectionDbPath(colName);
      const colDb = getCollectionDb(dbPath);
      const allEntities = colDb.select().from(entities).all();
      const collectionDir = join(home, "collections", colName);

      for (const entity of allEntities) {
        let content = "";
        if (entity.markdownPath) {
          const mdPath = join(collectionDir, entity.markdownPath);
          if (existsSync(mdPath)) {
            content = readFileSync(mdPath, "utf-8");
          }
        }
        // Truncate to avoid SQLITE_TOOBIG
        if (content.length > MAX_FTS_CONTENT) {
          content = content.slice(0, MAX_FTS_CONTENT);
        }
        const tags = colDb.select().from(entityTags)
          .where(eq(entityTags.entityId, entity.id))
          .all()
          .map((t) => t.tag)
          .join(" ");

        ftsSql.push(`INSERT INTO entities_fts (collection_name, entity_id, external_id, entity_type, title, content, tags) VALUES ('${escapeSQL(colName)}', ${entity.id}, '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(content)}', '${escapeSQL(tags)}');`);
      }
    }

    // Step 3b: Execute FTS in batches to stay under D1 file size limits
    console.log("  Uploading search index to D1...");
    const FTS_BATCH_SIZE = 200;
    for (let i = 0; i < ftsSql.length; i += FTS_BATCH_SIZE) {
      const batch = ftsSql.slice(i, i + FTS_BATCH_SIZE);
      const batchFile = writeTempFile(batch.join("\n"), ".sql");
      try {
        await executeD1File(d1DatabaseName, batchFile);
      } finally {
        cleanupTempFile(batchFile);
      }
    }

    // Step 4: Create or reuse R2 bucket
    console.log("  Setting up R2 bucket...");
    await createR2Bucket(r2BucketName);

    // Step 5: If update, get existing R2 manifest for stale file cleanup
    let existingR2Keys = new Set<string>();
    if (isUpdate) {
      try {
        const manifestJson = await executeD1Command(
          existingDeployment.d1DatabaseName || d1DatabaseName,
          "SELECT key FROM r2_manifest",
        );
        const parsed = JSON.parse(manifestJson);
        // D1 JSON output is an array of result sets; first result has `results` array
        const results = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
        if (Array.isArray(results)) {
          for (const row of results) {
            existingR2Keys.add(row.key);
          }
        }
      } catch {
        // Manifest may not exist on old deployments — proceed without cleanup
      }
    }

    // Step 6: Upload files to R2
    // Build list of all files to upload
    const uploads: Array<{ r2Key: string; fullPath: string }> = [];

    for (const colName of collectionNames) {
      const collectionDir = join(home, "collections", colName);
      for (const file of collectFiles(join(collectionDir, "markdown"))) {
        uploads.push({ r2Key: `${colName}/markdown/${file.relativePath}`, fullPath: file.fullPath });
      }
      for (const file of collectFiles(join(collectionDir, "attachments"))) {
        uploads.push({ r2Key: `${colName}/attachments/${file.relativePath}`, fullPath: file.fullPath });
      }
    }

    const uiDistDir = join(import.meta.dir, "../../../ui/dist");
    if (existsSync(uiDistDir)) {
      for (const file of collectFiles(uiDistDir)) {
        uploads.push({ r2Key: `_ui/${file.relativePath}`, fullPath: file.fullPath });
      }
    } else {
      console.warn("  Warning: UI dist not found. Run 'bun run build:ui' first.");
    }

    console.log(`  Uploading ${uploads.length} files to R2 (10 concurrent)...`);
    const uploadedKeys = new Set<string>();
    let uploadCount = 0;

    await runConcurrent(uploads, 10, async ({ r2Key, fullPath }) => {
      await putR2Object(r2BucketName, r2Key, fullPath, getMimeType(fullPath));
      uploadedKeys.add(r2Key);
      uploadCount++;
      if (uploadCount % 50 === 0) {
        console.log(`    ${uploadCount}/${uploads.length} files uploaded...`);
      }
    });

    console.log(`  Uploaded ${uploadCount} files to R2`);

    // Step 7: Delete stale R2 objects
    if (isUpdate && existingR2Keys.size > 0) {
      const staleKeys = [...existingR2Keys].filter((key) => !uploadedKeys.has(key));
      if (staleKeys.length > 0) {
        console.log(`  Removing ${staleKeys.length} stale file(s)...`);
        await runConcurrent(staleKeys, 10, async (key) => {
          await deleteR2Object(r2BucketName, key);
        });
      }
    }

    // Step 8: Update R2 manifest in D1
    const manifestSql: string[] = [];
    manifestSql.push("DELETE FROM r2_manifest;");
    for (const key of uploadedKeys) {
      manifestSql.push(`INSERT INTO r2_manifest (key) VALUES ('${escapeSQL(key)}');`);
    }
    const manifestFile = writeTempFile(manifestSql.join("\n"), ".sql");
    try {
      await executeD1File(d1DatabaseName, manifestFile);
    } finally {
      cleanupTempFile(manifestFile);
    }

    // Step 9: Deploy worker
    console.log("  Deploying worker...");
    const workerBundlePath = join(import.meta.dir, "../../../worker/dist/worker.js");
    if (!existsSync(workerBundlePath)) {
      console.error("Worker bundle not found. Run 'cd packages/worker && bun run build' first.");
      process.exit(1);
    }

    const tomlContent = generateWranglerToml({
      workerName,
      mainScript: workerBundlePath,
      d1DatabaseName,
      d1DatabaseId,
      r2BucketName,
      passwordHash,
    });
    const tomlFile = writeTempFile(tomlContent, ".toml");
    let workerUrl = "";
    try {
      workerUrl = await deployWorker(tomlFile);
    } finally {
      cleanupTempFile(tomlFile);
    }

    // If URL not parsed from output, construct it
    if (!workerUrl) {
      workerUrl = `https://${workerName}.workers.dev`;
    }
    const mcpUrl = `${workerUrl}/mcp`;

    // Step 10: Save deployment
    addDeployment(workerName, {
      url: workerUrl,
      mcpUrl,
      collections: collectionNames,
      d1DatabaseId,
      d1DatabaseName,
      r2BucketName,
      passwordProtected: !!opts.password,
      publishedAt: new Date().toISOString(),
    });

    // Step 11: Print results
    const verb = isUpdate ? "Updated" : "Published";
    console.log(`\n${verb} ${collectionNames.length} collection(s) to Cloudflare!\n`);
    console.log(`Worker:  ${workerName}`);
    console.log(`Website: ${workerUrl}`);
    console.log(`MCP URL: ${mcpUrl}`);
    if (opts.password) {
      console.log(`\nMCP Setup (Claude Code):`);
      console.log(`  claude mcp add veecontext --transport streamable-http \\`);
      console.log(`    --url ${mcpUrl} \\`);
      console.log(`    --header "Authorization: Bearer <password>"`);
    }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nPublish failed: ${message}`);
      process.exit(1);
    }
  });
