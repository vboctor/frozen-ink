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
import { createGenerateThemeEngine } from "./generate";

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

async function hashDbFiles(dbPath: string): Promise<string> {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  const chunks: Uint8Array[] = [];
  for (const file of files) {
    if (existsSync(file)) chunks.push(readFileSync(file));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  const hashBuf = await crypto.subtle.digest("SHA-256", combined);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
    putR2String,
    getR2String,
    deleteR2Objects,
    listR2Objects,
    deployWorker,
    generateWranglerToml,
    writeTempFile,
    cleanupTempFile,
  } = await import("./wrangler-api");

  await checkWranglerAuth();

  const { collectionName, removePassword = false, forcePublic = false } = options;
  let { workerOnly = false } = options;
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

  // Password-only changes on existing deployments only need a worker redeploy
  if (isUpdate && !workerOnly && (password || removePassword)) {
    workerOnly = true;
    onProgress("info", "Password change — deploying worker only");
  }

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

  // --- Phase 1: Create infrastructure + deploy worker ---

  if (!workerOnly) {
    onProgress("d1", "Setting up D1 database...");
    const d1 = await createD1(d1DatabaseName);
    d1DatabaseId = d1.uuid;
    onProgress("d1", `D1 database: ${d1DatabaseName} (${d1DatabaseId})`);
  }

  onProgress("r2", "Setting up R2 bucket...");
  await createR2Bucket(r2BucketName);

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

  // --- Phase 2: R2 uploads (before D1 rebuild so the site stays live on old data) ---

  const uiDistDir = resolveUiDist(__moduleDir) ?? "";
  let fileSizes = new Map<string, number>();

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
    // Read R2 manifest from D1 (still intact — D1 hasn't been rebuilt yet)
    const existingR2Manifest = new Map<string, number>();
    if (isUpdate) {
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

    const uploads: Array<{ r2Key: string; fullPath: string }> = [];
    for (const colName of collectionNames) {
      const collectionDir = join(home, "collections", colName);
      for (const file of collectFiles(join(collectionDir, "content"))) {
        if (file.relativePath.endsWith(".md") || file.relativePath.endsWith(".yml")) continue;
        uploads.push({ r2Key: `${colName}/content/${file.relativePath}`, fullPath: file.fullPath });
      }
    }
    if (existsSync(uiDistDir)) {
      for (const file of collectFiles(uiDistDir)) {
        uploads.push({ r2Key: `_ui/${file.relativePath}`, fullPath: file.fullPath });
      }
    }

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

    let uploadCount = 0;
    const pendingManifest: Array<{ key: string; size: number }> = [];
    const CHECKPOINT_INTERVAL = 500;

    const flushManifestCheckpoint = async () => {
      if (pendingManifest.length === 0) return;
      const batch = pendingManifest.splice(0);
      const sql = batch
        .map((e) => `INSERT OR REPLACE INTO r2_manifest (key, size) VALUES ('${escapeSQL(e.key)}', ${e.size});`)
        .join("\n");
      const tmpFile = writeTempFile(sql, ".sql");
      try {
        await executeD1File(d1DatabaseName, tmpFile);
      } finally {
        cleanupTempFile(tmpFile);
      }
    };

    await runConcurrent(toUpload, 3, async ({ r2Key, fullPath }) => {
      await putR2Object(r2BucketName, r2Key, fullPath, getMimeType(fullPath));
      pendingManifest.push({ key: r2Key, size: fileSizes.get(r2Key)! });
      uploadCount++;
      if (uploadCount % CHECKPOINT_INTERVAL === 0) {
        onProgress("r2-upload", `${uploadCount}/${toUpload.length} files uploaded`);
        await flushManifestCheckpoint();
      }
    });
    await flushManifestCheckpoint();

    // Stale cleanup via R2 list (source of truth)
    let deletedCount = 0;
    if (isUpdate) {
      const allKeys = new Set(fileSizes.keys());
      onProgress("r2-cleanup", "Checking for stale R2 files...");
      try {
        const remoteKeys = await listR2Objects(r2BucketName);
        const staleKeys = remoteKeys.filter((key) => !allKeys.has(key) && !key.endsWith("/db-digest"));
        if (staleKeys.length > 0) {
          onProgress("r2-cleanup", `Removing ${staleKeys.length} stale file(s)...`);
          await deleteR2Objects(r2BucketName, staleKeys);
          deletedCount = staleKeys.length;
        }
      } catch {
        onProgress("r2-cleanup", "Warning: could not list R2 objects for stale cleanup");
      }
    }

    const totalFiles = uploads.length;
    const parts = [`${uploadCount} uploaded`];
    if (deletedCount > 0) parts.push(`${deletedCount} deleted`);
    if (skippedCount > 0) parts.push(`${skippedCount} unchanged`);
    onProgress("r2-upload", `${parts.join(", ")} out of ${totalFiles} total`);
  }

  // --- Phase 3: D1 rebuild (destructive — done last to minimize downtime) ---

  let dbDigest = "";
  if (!workerOnly) {
    const dbPath = getCollectionDbPath(collectionName);
    dbDigest = await hashDbFiles(dbPath);

    let remoteDigest: string | null = null;
    if (isUpdate) {
      try {
        remoteDigest = await getR2String(r2BucketName, `${collectionName}/db-digest`);
      } catch { /* ignore — treat as no digest */ }
    }
    const skipD1 = isUpdate && remoteDigest === dbDigest;

    if (skipD1) {
      onProgress("d1-build", `Database unchanged (digest match) — skipping D1 rebuild`);
    } else {
    onProgress("d1-build", "Building D1 payload...");
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

    // Write R2 manifest into the schema SQL so it's part of the rebuild
    for (const [key, size] of fileSizes) {
      schemaSql.push(`INSERT INTO r2_manifest (key, size) VALUES ('${escapeSQL(key)}', ${size});`);
    }

    const themeEngine = createGenerateThemeEngine();
    const MAX_DATA_LEN = 50000;
    const MAX_FTS_CONTENT = 8000;

    // FTS table created alongside other tables, populated inline with entities
    schemaSql.push("CREATE VIRTUAL TABLE entities_fts USING fts5(collection_name UNINDEXED, entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags);");

    let entityIdOffset = 0;

    for (const colName of collectionNames) {
      const col = getCollection(colName)!;
      const dbPath = getCollectionDbPath(colName);
      const colDb = getCollectionDb(dbPath);
      const title = col.title || colName;

      schemaSql.push(`INSERT INTO collections_meta (name, title, crawler_type) VALUES ('${escapeSQL(colName)}', '${escapeSQL(title)}', '${escapeSQL(col.crawler)}');`);

      const allEntities = colDb.select().from(entities).all();
      const entityIdMap = new Map<number, number>();

      // Pre-build tag lookup and per-entity tag names for FTS
      const tagNameCache: Record<number, string> = {};
      const entityTagMap = new Map<number, string[]>();
      for (const et of colDb.select().from(entityTags).all()) {
        let tagName = tagNameCache[et.tagId];
        if (!tagName) {
          const [tagRow] = colDb.select().from(tags).where(eq(tags.id, et.tagId)).all();
          tagName = tagRow?.name ?? `tag_${et.tagId}`;
          tagNameCache[et.tagId] = tagName;
        }
        const existing = entityTagMap.get(et.entityId) ?? [];
        existing.push(tagName);
        entityTagMap.set(et.entityId, existing);
      }

      // Build entity path lookup for theme cross-reference resolution
      const entityPathMap = new Map<string, string>();
      for (const e of allEntities) {
        if (!e.markdownPath) continue;
        const prefix = "content/";
        const rel = e.markdownPath.startsWith(prefix) ? e.markdownPath.slice(prefix.length) : e.markdownPath;
        entityPathMap.set(e.externalId, rel.endsWith(".md") ? rel.slice(0, -3) : rel);
      }

      for (const entity of allEntities) {
        entityIdOffset++;
        entityIdMap.set(entity.id, entityIdOffset);
        let data = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);
        if (data.length > MAX_DATA_LEN) data = data.slice(0, MAX_DATA_LEN);

        schemaSql.push(`INSERT INTO entities (id, collection_name, external_id, entity_type, title, data, markdown_path, url, created_at, updated_at) VALUES (${entityIdOffset}, '${escapeSQL(colName)}', '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(data)}', ${entity.markdownPath ? `'${escapeSQL(entity.markdownPath)}'` : "NULL"}, ${entity.url ? `'${escapeSQL(entity.url)}'` : "NULL"}, ${entity.createdAt ? `'${escapeSQL(entity.createdAt)}'` : "NULL"}, ${entity.updatedAt ? `'${escapeSQL(entity.updatedAt)}'` : "NULL"});`);

        // Generate FTS content from theme engine (same as worker on-demand rendering)
        const entityTags_ = entityTagMap.get(entity.id) ?? [];
        let ftsContent = "";
        if (entity.markdownPath && themeEngine.has(col.crawler)) {
          try {
            const parsedData = typeof entity.data === "string" ? JSON.parse(entity.data) : entity.data;
            ftsContent = themeEngine.render({
              entity: {
                externalId: entity.externalId,
                entityType: entity.entityType,
                title: entity.title,
                data: parsedData,
                url: entity.url ?? undefined,
                tags: entityTags_,
              },
              collectionName: colName,
              crawlerType: col.crawler,
              lookupEntityPath: (id) => entityPathMap.get(id),
            });
          } catch { /* fall back to empty content */ }
        }
        if (ftsContent.length > MAX_FTS_CONTENT) ftsContent = ftsContent.slice(0, MAX_FTS_CONTENT);

        schemaSql.push(`INSERT INTO entities_fts (collection_name, entity_id, external_id, entity_type, title, content, tags) VALUES ('${escapeSQL(colName)}', ${entityIdOffset}, '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(ftsContent)}', '${escapeSQL(entityTags_.join(" "))}');`);
      }

      // Write entity_tags and tags using the pre-built lookup
      const remoteTagNameToId: Record<string, number> = {};
      let remoteTagIdCounter = 0;
      for (const et of colDb.select().from(entityTags).all()) {
        const remoteId = entityIdMap.get(et.entityId);
        if (!remoteId) continue;
        const tagName = tagNameCache[et.tagId];
        if (!remoteTagNameToId[tagName]) {
          remoteTagIdCounter++;
          remoteTagNameToId[tagName] = remoteTagIdCounter;
          schemaSql.push(`INSERT INTO tags (id, name) VALUES (${remoteTagIdCounter}, '${escapeSQL(tagName)}');`);
        }
        schemaSql.push(`INSERT INTO entity_tags (collection_name, entity_id, tag_id) VALUES ('${escapeSQL(colName)}', ${remoteId}, ${remoteTagNameToId[tagName]});`);
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

      onProgress("d1-build", `Built "${colName}": ${allEntities.length} entities`);
    }

    // Upload in batches (D1 has execution time limits on large SQL files)
    const D1_BATCH_SIZE = 500;
    const totalBatches = Math.ceil(schemaSql.length / D1_BATCH_SIZE);
    onProgress("d1-upload", `Uploading to D1 (${totalBatches} batches)...`);
    let batchCount = 0;
    for (let i = 0; i < schemaSql.length; i += D1_BATCH_SIZE) {
      const batch = schemaSql.slice(i, i + D1_BATCH_SIZE);
      const batchFile = writeTempFile(batch.join("\n"), ".sql");
      try {
        await executeD1File(d1DatabaseName, batchFile);
        batchCount++;
        if (batchCount % 5 === 0 || batchCount === totalBatches) {
          onProgress("d1-upload", `Uploading to D1... ${batchCount}/${totalBatches} batches`);
        }
      } finally {
        cleanupTempFile(batchFile);
      }
    }
    await putR2String(r2BucketName, `${collectionName}/db-digest`, dbDigest);
    } // else: D1 rebuild
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
    ...(dbDigest ? { dbDigest } : {}),
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
