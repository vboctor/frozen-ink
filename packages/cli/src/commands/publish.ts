import { Command } from "commander";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { createInterface } from "readline";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  getCollection,
  getCollectionDbPath,
  getCollectionPublishState,
  updateCollectionPublishState,
  entities,
  entityTags,
  tags,
  links,
  assets,
  getModuleDir,
  resolveWorkerBundle,
  resolveUiDist,
} from "@frozenink/core";

const __moduleDir = getModuleDir(import.meta.url);
import { eq } from "drizzle-orm";
import { assertInitialPublishConfirmation } from "./publish-policy";

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
  ".yml": "text/yaml",
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

// --- Reusable publish function ---

export interface PublishOptions {
  collectionName: string;
  toolDescription?: string;
  password?: string;
  removePassword?: boolean;
  forcePublic?: boolean;
  workerOnly?: boolean;
}

export interface PublishResult {
  workerName: string;
  workerUrl: string;
  mcpUrl: string;
  toolDescription?: string;
  collectionName: string;
  isUpdate: boolean;
  workerOnly: boolean;
}

export type PublishProgressCallback = (step: string, detail: string) => void;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const data = new TextEncoder().encode(salt + password);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${salt}:${hashHex}`;
}

function deriveToolDescription(collectionName: string): string | undefined {
  return getCollection(collectionName)?.mcpToolDescription?.trim() || undefined;
}

async function promptToolDescription(
  initialValue?: string,
): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return initialValue;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const label = initialValue
    ? `MCP tool description [${initialValue}] (optional): `
    : "MCP tool description (optional): ";
  const answer = await new Promise<string>((resolve) => {
    rl.question(label, (value) => resolve(value));
  });
  rl.close();

  const trimmed = answer.trim();
  return trimmed || initialValue;
}

/**
 * Core publish logic, callable from both CLI and desktop app.
 * Progress is reported via the onProgress callback instead of console.log.
 */
export async function publishCollections(
  options: PublishOptions,
  onProgress: PublishProgressCallback = () => {},
): Promise<PublishResult> {
  const {
    checkWranglerAuth,
    createD1,
    executeD1File,
    executeD1Command,
    createR2Bucket,
    putR2Object,
    deleteR2Object,
    listR2Objects,
    deployWorker,
    generateWranglerToml,
    writeTempFile,
    cleanupTempFile,
  } = await import("./wrangler-api");

  await checkWranglerAuth();

  const { collectionName, workerOnly = false, removePassword = false, forcePublic = false } = options;
  const workerName = collectionName;
  const password = options.password?.trim();
  if (password && removePassword) {
    throw new Error("Cannot use --password and --remove-password together.");
  }
  const collectionNames = [collectionName];

  const col = getCollection(collectionName);
  if (!col) throw new Error(`Collection "${collectionName}" not found`);

  let toolDescription = options.toolDescription?.trim()
    || col.description?.trim()
    || col.mcpToolDescription?.trim()
    || undefined;

  const existingPublish = getCollectionPublishState(collectionName);
  const isUpdate = !!existingPublish;

  if (workerOnly && !existingPublish) {
    throw new Error(`Collection "${collectionName}" has not been published. --worker-only only works for published collections.`);
  }

  const home = getFrozenInkHome();

  // Validate collection database
  if (!workerOnly) {
    const dbPath = getCollectionDbPath(collectionName);
    if (!existsSync(dbPath)) throw new Error(`Collection "${collectionName}" database not found at ${dbPath}`);
  }

  let d1DatabaseName = `${workerName}-db`;
  let d1DatabaseId = "";
  let r2BucketName = `${workerName}-files`;

  // Password behavior:
  // - New password supplied: rotate hash.
  // - removePassword=true: clear protection.
  // - Otherwise preserve existing hash on updates.
  let passwordHash = "";
  if (password) {
    passwordHash = await hashPassword(password);
  } else if (removePassword) {
    passwordHash = "";
  } else if (existingPublish?.password?.hash) {
    passwordHash = existingPublish.password.hash;
  } else if (isUpdate && existingPublish?.password?.protected) {
    throw new Error(
      `Collection "${collectionName}" is password protected but no reusable password hash is stored locally. ` +
      "Re-publish with --password <new-password> to rotate credentials or --remove-password to disable protection.",
    );
  }

  assertInitialPublishConfirmation({ isUpdate, workerOnly, passwordHash, forcePublic });

  // --- Phase 1: Create resources + deploy worker ---
  // The worker must be deployed before data so the site is reachable
  // even while data is still uploading.

  if (!workerOnly) {
    onProgress("d1", "Setting up D1 database...");
    const d1 = await createD1(d1DatabaseName);
    d1DatabaseId = d1.uuid;
    onProgress("d1", `D1 database: ${d1DatabaseName} (${d1DatabaseId})`);
  }

  onProgress("r2", "Setting up R2 bucket...");
  await createR2Bucket(r2BucketName);

  // Deploy worker (before data upload)
  onProgress("deploy", "Deploying worker...");
  const workerBundlePath = resolveWorkerBundle(__moduleDir);
  if (!workerBundlePath || !existsSync(workerBundlePath)) {
    throw new Error("Worker bundle not found. If developing locally, run 'cd packages/worker && bun run build'.");
  }

  const tomlContent = generateWranglerToml({
    workerName,
    mainScript: workerBundlePath,
    d1DatabaseName,
    d1DatabaseId,
    r2BucketName,
    passwordHash,
    toolDescription,
  });
  const tomlFile = writeTempFile(tomlContent, ".toml");
  let workerUrl = "";
  try {
    workerUrl = await deployWorker(tomlFile);
  } finally {
    cleanupTempFile(tomlFile);
  }

  // --- Phase 2: Upload data ---

  // Read R2 manifest BEFORE dropping D1 tables (needed for skip-unchanged and stale cleanup)
  const existingR2Manifest = new Map<string, number>();
  if (!workerOnly && isUpdate) {
    try {
      onProgress("r2-manifest", "Reading existing R2 manifest...");
      const manifestJson = await executeD1Command(
        d1DatabaseName,
        "SELECT key, size FROM r2_manifest",
      );
      const parsed = JSON.parse(manifestJson);
      const results = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
      if (Array.isArray(results)) {
        for (const row of results) existingR2Manifest.set(row.key, row.size ?? -1);
      }
    } catch {
      // Manifest table may not exist or lack size column on old deployments
    }
  }

  if (!workerOnly) {
    onProgress("export", "Building database export...");
    const schemaSql: string[] = [];

    schemaSql.push("DROP TABLE IF EXISTS entities_fts;");
    schemaSql.push("DROP TABLE IF EXISTS r2_manifest;");
    schemaSql.push("DROP TABLE IF EXISTS links;");
    schemaSql.push("DROP TABLE IF EXISTS entity_tags;");
    schemaSql.push("DROP TABLE IF EXISTS tags;");
    schemaSql.push("DROP TABLE IF EXISTS assets;");
    schemaSql.push("DROP TABLE IF EXISTS entities;");
    schemaSql.push("DROP TABLE IF EXISTS collections_meta;");
    schemaSql.push("");
    schemaSql.push("CREATE TABLE collections_meta (name TEXT PRIMARY KEY, title TEXT, crawler_type TEXT);");
    schemaSql.push(`CREATE TABLE entities (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  external_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  title TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  markdown_path TEXT, url TEXT, created_at TEXT, updated_at TEXT
);`);
    schemaSql.push("CREATE INDEX idx_entities_collection ON entities(collection_name);");
    schemaSql.push("CREATE INDEX idx_entities_external ON entities(collection_name, external_id);");
    schemaSql.push("CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);");
    schemaSql.push(`CREATE TABLE entity_tags (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  entity_id INTEGER NOT NULL, tag_id INTEGER NOT NULL
);`);
    schemaSql.push(`CREATE TABLE links (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  source_entity_id INTEGER NOT NULL,
  target_entity_id INTEGER NOT NULL
);`);
    schemaSql.push("CREATE INDEX idx_links_target ON links(target_entity_id);");
    schemaSql.push("CREATE INDEX idx_links_source ON links(source_entity_id);");
    schemaSql.push(`CREATE TABLE assets (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  entity_id INTEGER NOT NULL, filename TEXT NOT NULL,
  mime_type TEXT NOT NULL, storage_path TEXT NOT NULL
);`);
    schemaSql.push("CREATE TABLE r2_manifest (key TEXT PRIMARY KEY, size INTEGER NOT NULL DEFAULT 0);");
    schemaSql.push("");

    let entityIdOffset = 0;
    const MAX_DATA_LEN = 50000;

    for (const colName of collectionNames) {
      const col = getCollection(colName)!;
      const dbPath = getCollectionDbPath(colName);
      const colDb = getCollectionDb(dbPath);
      const title = col.title || colName;

      schemaSql.push(`INSERT INTO collections_meta (name, title, crawler_type) VALUES ('${escapeSQL(colName)}', '${escapeSQL(title)}', '${escapeSQL(col.crawler)}');`);

      const allEntities = colDb.select().from(entities).all();
      const entityIdMap = new Map<number, number>();

      for (const entity of allEntities) {
        entityIdOffset++;
        entityIdMap.set(entity.id, entityIdOffset);
        let data = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);
        if (data.length > MAX_DATA_LEN) data = data.slice(0, MAX_DATA_LEN);

        schemaSql.push(`INSERT INTO entities (id, collection_name, external_id, entity_type, title, data, markdown_path, url, created_at, updated_at) VALUES (${entityIdOffset}, '${escapeSQL(colName)}', '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(data)}', ${entity.markdownPath ? `'${escapeSQL(entity.markdownPath)}'` : "NULL"}, ${entity.url ? `'${escapeSQL(entity.url)}'` : "NULL"}, ${entity.createdAt ? `'${escapeSQL(entity.createdAt)}'` : "NULL"}, ${entity.updatedAt ? `'${escapeSQL(entity.updatedAt)}'` : "NULL"});`);
      }

      // Export tags and entity_tags — resolve tagId to tag name via tags table
      const tagNameCache: Record<number, string> = {};
      const remoteTagNameToId: Record<string, number> = {};
      let remoteTagIdCounter = 0;
      for (const et of colDb.select().from(entityTags).all()) {
        const remoteId = entityIdMap.get(et.entityId);
        if (!remoteId) continue;
        // Resolve tag name from local tags table
        let tagName = tagNameCache[et.tagId];
        if (!tagName) {
          const [tagRow] = colDb.select().from(tags).where(eq(tags.id, et.tagId)).all();
          tagName = tagRow?.name ?? `tag_${et.tagId}`;
          tagNameCache[et.tagId] = tagName;
        }
        // Insert into remote tags table if not already done
        if (!remoteTagNameToId[tagName]) {
          remoteTagIdCounter++;
          remoteTagNameToId[tagName] = remoteTagIdCounter;
          schemaSql.push(`INSERT INTO tags (id, name) VALUES (${remoteTagIdCounter}, '${escapeSQL(tagName)}');`);
        }
        const remoteTagId = remoteTagNameToId[tagName];
        schemaSql.push(`INSERT INTO entity_tags (collection_name, entity_id, tag_id) VALUES ('${escapeSQL(colName)}', ${remoteId}, ${remoteTagId});`);
      }

      for (const link of colDb.select().from(links).all()) {
        const remoteSourceId = entityIdMap.get(link.sourceEntityId);
        const remoteTargetId = entityIdMap.get(link.targetEntityId);
        if (!remoteSourceId || !remoteTargetId) continue;
        schemaSql.push(`INSERT INTO links (collection_name, source_entity_id, target_entity_id) VALUES ('${escapeSQL(colName)}', ${remoteSourceId}, ${remoteTargetId});`);
      }

      for (const att of colDb.select().from(assets).all()) {
        const remoteId = entityIdMap.get(att.entityId);
        if (!remoteId) continue;
        schemaSql.push(`INSERT INTO assets (collection_name, entity_id, filename, mime_type, storage_path) VALUES ('${escapeSQL(colName)}', ${remoteId}, '${escapeSQL(att.filename)}', '${escapeSQL(att.mimeType)}', '${escapeSQL(att.storagePath)}');`);
      }

      onProgress("export", `Exported "${colName}": ${allEntities.length} entities`);
    }

    onProgress("d1-upload", "Uploading schema and data to D1...");
    const schemaFile = writeTempFile(schemaSql.join("\n"), ".sql");
    try {
      await executeD1File(d1DatabaseName, schemaFile);
    } finally {
      cleanupTempFile(schemaFile);
    }

    onProgress("fts", "Building search index...");
    const MAX_FTS_CONTENT = 8000;
    const ftsSql: string[] = [];
    ftsSql.push("CREATE VIRTUAL TABLE entities_fts USING fts5(collection_name UNINDEXED, entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags);");

    let ftsBuilt = 0;
    for (const colName of collectionNames) {
      const dbPath = getCollectionDbPath(colName);
      const colDb = getCollectionDb(dbPath);
      const allEntities = colDb.select().from(entities).all();
      const ftsTotal = allEntities.length;
      const collectionDir = join(home, "collections", colName);

      for (const entity of allEntities) {
        let content = "";
        if (entity.markdownPath) {
          const mdPath = join(collectionDir, entity.markdownPath);
          if (existsSync(mdPath)) {
            content = readFileSync(mdPath, "utf-8");
          }
        }
        if (content.length > MAX_FTS_CONTENT) {
          content = content.slice(0, MAX_FTS_CONTENT);
        }
        const entityTagNames = colDb.select().from(entityTags)
          .where(eq(entityTags.entityId, entity.id))
          .all()
          .map((t: any) => {
            const [tagRow] = colDb.select().from(tags).where(eq(tags.id, t.tagId)).all();
            return tagRow?.name ?? "";
          })
          .filter(Boolean)
          .join(" ");

        ftsSql.push(`INSERT INTO entities_fts (collection_name, entity_id, external_id, entity_type, title, content, tags) VALUES ('${escapeSQL(colName)}', ${entity.id}, '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(content)}', '${escapeSQL(entityTagNames)}');`);
        ftsBuilt++;
        if (ftsBuilt % 500 === 0) {
          onProgress("fts", `Building search index... ${ftsBuilt}/${ftsTotal} entities`);
        }
      }
    }
    onProgress("fts", `Built search index: ${ftsBuilt} entries`);

    const ftsBatches = Math.ceil((ftsSql.length - 1) / 200);
    onProgress("fts-upload", `Uploading search index to D1 (${ftsBatches} batches)...`);
    const FTS_BATCH_SIZE = 200;
    let ftsBatchCount = 0;
    for (let i = 0; i < ftsSql.length; i += FTS_BATCH_SIZE) {
      const batch = ftsSql.slice(i, i + FTS_BATCH_SIZE);
      const batchFile = writeTempFile(batch.join("\n"), ".sql");
      try {
        await executeD1File(d1DatabaseName, batchFile);
        ftsBatchCount++;
        if (ftsBatchCount % 5 === 0 || ftsBatchCount === ftsBatches) {
          onProgress("fts-upload", `Uploading search index... ${ftsBatchCount}/${ftsBatches} batches`);
        }
      } finally {
        cleanupTempFile(batchFile);
      }
    }
  }

  // R2 uploads
  const uiDistDir = resolveUiDist(__moduleDir) ?? "";
  if (workerOnly) {
    const uiUploads: Array<{ r2Key: string; fullPath: string }> = [];
    if (existsSync(uiDistDir)) {
      for (const file of collectFiles(uiDistDir)) {
        uiUploads.push({ r2Key: `_ui/${file.relativePath}`, fullPath: file.fullPath });
      }
    }
    if (uiUploads.length > 0) {
      onProgress("r2-upload", `Uploading ${uiUploads.length} UI asset(s) to R2...`);
      await runConcurrent(uiUploads, 3, async ({ r2Key, fullPath }) => {
        await putR2Object(r2BucketName, r2Key, fullPath, getMimeType(fullPath));
      });
    }
  } else {
    // existingR2Keys was populated before D1 tables were dropped (see above)
    const uploads: Array<{ r2Key: string; fullPath: string }> = [];
    for (const colName of collectionNames) {
      const collectionDir = join(home, "collections", colName);
      for (const file of collectFiles(join(collectionDir, "content"))) {
        uploads.push({ r2Key: `${colName}/content/${file.relativePath}`, fullPath: file.fullPath });
      }
    }
    if (existsSync(uiDistDir)) {
      for (const file of collectFiles(uiDistDir)) {
        uploads.push({ r2Key: `_ui/${file.relativePath}`, fullPath: file.fullPath });
      }
    }

    // Skip files whose size matches the existing manifest
    const fileSizes = new Map<string, number>();
    const toUpload: Array<{ r2Key: string; fullPath: string }> = [];
    let skippedCount = 0;
    for (const { r2Key, fullPath } of uploads) {
      const localSize = statSync(fullPath).size;
      fileSizes.set(r2Key, localSize);
      if (existingR2Manifest.get(r2Key) === localSize) {
        skippedCount++;
      } else {
        toUpload.push({ r2Key, fullPath });
      }
    }
    if (skippedCount > 0) {
      onProgress("r2-upload", `${skippedCount} unchanged files skipped, uploading ${toUpload.length}...`);
    } else {
      onProgress("r2-upload", `Uploading ${toUpload.length} files to R2...`);
    }

    const uploadedKeys = new Set<string>();
    let uploadCount = 0;
    await runConcurrent(toUpload, 3, async ({ r2Key, fullPath }) => {
      await putR2Object(r2BucketName, r2Key, fullPath, getMimeType(fullPath));
      uploadedKeys.add(r2Key);
      uploadCount++;
      if (uploadCount % 500 === 0 || uploadCount === toUpload.length) {
        onProgress("r2-upload", `${uploadCount}/${toUpload.length} files uploaded`);
      }
    });
    const allKeys = new Set(fileSizes.keys());
    onProgress("r2-upload", `Uploaded ${uploadCount} files to R2${skippedCount > 0 ? ` (${skippedCount} unchanged)` : ""}`);

    // Stale cleanup: list actual R2 objects (source of truth) and delete any not in current set
    if (isUpdate) {
      onProgress("r2-cleanup", "Checking for stale R2 files...");
      try {
        const remoteKeys = await listR2Objects(r2BucketName);
        const staleKeys = remoteKeys.filter((key) => !allKeys.has(key));
        if (staleKeys.length > 0) {
          onProgress("r2-cleanup", `Removing ${staleKeys.length} stale file(s)...`);
          await runConcurrent(staleKeys, 3, async (key) => deleteR2Object(r2BucketName, key));
        }
      } catch {
        onProgress("r2-cleanup", "Warning: could not list R2 objects for stale cleanup");
      }
    }

    const manifestSql = ["DELETE FROM r2_manifest;"];
    for (const [key, size] of fileSizes) {
      manifestSql.push(`INSERT INTO r2_manifest (key, size) VALUES ('${escapeSQL(key)}', ${size});`);
    }
    const manifestFile = writeTempFile(manifestSql.join("\n"), ".sql");
    try {
      await executeD1File(d1DatabaseName, manifestFile);
    } finally {
      cleanupTempFile(manifestFile);
    }
  }

  if (!workerUrl) {
    workerUrl = `https://${workerName}.workers.dev`;
  }
  const mcpUrl = `${workerUrl}/mcp`;
  const passwordProtected = passwordHash.length > 0;

  // Save publish state on the collection
  updateCollectionPublishState(collectionName, {
    url: workerUrl,
    mcpUrl,
    password: { protected: passwordProtected, hash: passwordHash || undefined },
    publishedAt: new Date().toISOString(),
  });

  onProgress("done", "Publish completed");

  return {
    workerName,
    workerUrl,
    mcpUrl,
    toolDescription,
    collectionName,
    isUpdate,
    workerOnly,
  };
}

// --- CLI command ---

export const publishCommand = new Command("publish")
  .description("Publish a collection to Cloudflare as a password-protected website with MCP access")
  .argument("<collection>", "Collection name to publish")
  .option("--password <password>", "Password to protect access")
  .option("--remove-password", "Explicitly remove password protection")
  .option("--public", "Explicitly allow public access on initial publish (skip confirmation prompt)")
  .option("--tool-description <description>", "Tool description advertised to MCP clients")
  .option("--worker-only", "Deploy worker code only (skip D1/R2 data upload)")
  .action(async (collectionNameArg: string, opts: {
    password?: string;
    removePassword?: boolean;
    public?: boolean;
    toolDescription?: string;
    workerOnly?: boolean;
  }) => {
    try {
      ensureInitialized();

      const workerOnly = !!opts.workerOnly;
      const collectionName = collectionNameArg;

      if (!collectionName) {
        console.error("No collection specified.");
        process.exit(1);
      }

      let forcePublic = !!opts.public;
      let toolDescription = opts.toolDescription?.trim() || undefined;

      if (!forcePublic && !opts.password && !workerOnly) {
        const existingPublish = getCollectionPublishState(collectionName);
        const isInitialPublish = !existingPublish;
        if (isInitialPublish && process.stdin.isTTY && process.stdout.isTTY) {
          console.warn("\nWARNING: No password was provided.");
          console.warn("This initial publish will make collection data publicly accessible.");
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question("Continue with public publish? Type 'yes' to continue: ", (value) => resolve(value));
          });
          rl.close();
          if (answer.trim().toLowerCase() !== "yes") {
            console.log("Publish cancelled.");
            process.exit(0);
          }
          forcePublic = true;
        }
      }

      if (!workerOnly && !toolDescription) {
        const derived = deriveToolDescription(collectionName);
        toolDescription = await promptToolDescription(derived);
      }

      const result = await publishCollections(
        {
          collectionName,
          toolDescription,
          password: opts.password,
          removePassword: opts.removePassword,
          forcePublic,
          workerOnly,
        },
        (step, detail) => console.log(`  [${step}] ${detail}`),
      );

      const verb = result.workerOnly ? "Deployed" : (result.isUpdate ? "Updated" : "Published");
      const summary = result.workerOnly
        ? "latest worker code to Cloudflare (data unchanged)"
        : `collection "${result.collectionName}" to Cloudflare`;
      console.log(`\n${verb} ${summary}!\n`);
      console.log(`Worker:  ${result.workerName}`);
      console.log(`Website: ${result.workerUrl}`);
      console.log(`MCP URL: ${result.mcpUrl}`);
      if (opts.password) {
        console.log(`\nMCP Setup (Claude Code):`);
        console.log(`  claude mcp add frozenink --transport streamable-http \\`);
        console.log(`    --url ${result.mcpUrl} \\`);
        console.log(`    --header "Authorization: Bearer <password>"`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nPublish failed: ${message}`);
      process.exit(1);
    }
  });
