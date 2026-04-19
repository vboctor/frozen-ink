import { Command } from "commander";
import { existsSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { createInterface } from "readline";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  getCollection,
  updateCollection,
  getCollectionDbPath,
  getCollectionPublishState,
  updateCollectionPublishState,
  entities,
  getModuleDir,
  resolveWorkerBundle,
  resolveUiDist,
  getNamedCredentials,
  saveNamedCredentials,
  removeNamedCredentials,
} from "@frozenink/core";
import { getPublishCredentialKey } from "./publish-credentials";
import type { EntityData } from "@frozenink/core";

const __moduleDir = getModuleDir(import.meta.url);
import { assertInitialPublishConfirmation } from "./publish-policy";
import { createGenerateThemeEngine } from "./generate";
import { RemoteClient } from "./remote-client";
import { computeSyncPlan, type LocalEntity, type ManifestEntity } from "./sync-plan";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function escapeSQL(str: string): string {
  // Strip C0 control characters (except \t \n \r). NULL bytes break SQLite's
  // C-based parser by acting as string terminators; other control chars render
  // as garbage in the worker UI. Source data sometimes contains them when bug
  // reports include binary file-upload code or other raw byte sequences.
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/'/g, "''");
}

function collectFiles(dir: string, base: string = ""): Array<{ relativePath: string; fullPath: string }> {
  if (!existsSync(dir)) return [];
  const files: Array<{ relativePath: string; fullPath: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);
    if (entry.name.startsWith(".")) continue;
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

// FNV-1a 32-bit. The published FTS5 schema declares `entity_id UNINDEXED` as
// the first column; it's only echoed back to clients (used as a React key in
// the search UI) and not joined against `entities.id`. A deterministic hash
// of external_id is enough — uniqueness within a result set is what matters.
function ftsEntityIdFor(externalId: string): number {
  let h = 2166136261;
  for (let i = 0; i < externalId.length; i++) {
    h = Math.imul(h ^ externalId.charCodeAt(i), 16777619);
  }
  return h >>> 0;
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
    executeD1Query,

    createR2Bucket,
    putR2Object,
    putR2String,
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
    if (col.crawler === "remote") {
      throw new Error(`Cannot publish "${collectionName}": crawler is "remote". Remote collections are read-only clones.`);
    }
  }

  let d1DatabaseName = `${workerName}-db`;
  let d1DatabaseId = "";
  let r2BucketName = `${workerName}-files`;

  // Password behavior:
  // - New password supplied: rotate hash, save plaintext to credentials.yml.
  // - removePassword=true: clear protection + remove credentials.yml entry.
  // - Otherwise reuse plaintext from credentials.yml on updates.
  const credentialKey = getPublishCredentialKey(collectionName);
  let passwordHash = "";
  let plaintextPassword = "";
  if (password) {
    plaintextPassword = password;
    passwordHash = await hashPassword(password);
  } else if (removePassword) {
    passwordHash = "";
  } else if (isUpdate) {
    const stored = getNamedCredentials(credentialKey);
    const storedPassword = typeof stored?.password === "string" ? stored.password : "";
    if (storedPassword) {
      plaintextPassword = storedPassword;
      passwordHash = await hashPassword(storedPassword);
    } else if (existingPublish?.protected) {
      throw new Error(
        `Collection "${collectionName}" is password protected but no reusable password is stored locally. ` +
        "Re-publish with --password <new-password> to rotate credentials or --remove-password to disable protection.",
      );
    }
  }

  assertInitialPublishConfirmation({ isUpdate, workerOnly, passwordHash, forcePublic });

  // Check worker bundle exists before touching any infrastructure
  const workerBundlePath = resolveWorkerBundle(__moduleDir);
  if (!workerBundlePath || !existsSync(workerBundlePath)) {
    throw new Error("Worker bundle not found. If developing locally, run 'cd packages/worker && bun run build'.");
  }

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
    // Fetch existing R2 objects once — used for both upload skipping and stale cleanup
    const existingR2Objects = new Map<string, number>();
    if (isUpdate) {
      try {
        onProgress("r2-list", "Listing existing R2 objects...");
        const remoteObjects = await listR2Objects(r2BucketName);
        for (const obj of remoteObjects) existingR2Objects.set(obj.key, obj.size);
      } catch {
        // Treat as empty on error; all files will be uploaded
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
      if (existingR2Objects.get(r2Key) === localSize) {
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
    await runConcurrent(toUpload, 3, async ({ r2Key, fullPath }) => {
      await putR2Object(r2BucketName, r2Key, fullPath, getMimeType(fullPath));
      uploadCount++;
    });

    // Stale cleanup: remove R2 keys no longer in the local set
    let deletedCount = 0;
    if (isUpdate) {
      const allKeys = new Set(fileSizes.keys());
      try {
        const staleKeys = [...existingR2Objects.keys()].filter((key) => !allKeys.has(key));
        if (staleKeys.length > 0) {
          onProgress("r2-cleanup", `Removing ${staleKeys.length} stale file(s)...`);
          await deleteR2Objects(r2BucketName, staleKeys);
          deletedCount = staleKeys.length;
        }
      } catch {
        onProgress("r2-cleanup", "Warning: could not clean up stale R2 files");
      }
    }

    const totalFiles = uploads.length;
    const parts = [`${uploadCount} uploaded`];
    if (deletedCount > 0) parts.push(`${deletedCount} deleted`);
    if (skippedCount > 0) parts.push(`${skippedCount} unchanged`);
    onProgress("r2-upload", `${parts.join(", ")} out of ${totalFiles} total`);
  }

  // --- Phase 3: D1 incremental update (manifest-driven delta) ---

  if (!workerOnly) {
    onProgress("d1-build", "Computing incremental plan...");

    // Ensure schema exists. Idempotent so first publish creates tables and
    // re-publish is a no-op. No DROPs — the manifest-driven delta below
    // brings D1 in sync without wiping it.
    const schemaInit: string[] = [];
    schemaInit.push(`CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  title TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT,
  folder TEXT,
  slug TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
    schemaInit.push("CREATE INDEX IF NOT EXISTS idx_entities_external ON entities(external_id);");
    schemaInit.push("CREATE INDEX IF NOT EXISTS idx_entities_folder   ON entities(folder, slug);");
    schemaInit.push("CREATE INDEX IF NOT EXISTS idx_entities_type     ON entities(entity_type);");
    schemaInit.push("CREATE INDEX IF NOT EXISTS idx_entities_updated  ON entities(updated_at);");
    schemaInit.push("CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags);");
    await executeD1Query(d1DatabaseId, schemaInit.join("\n"));

    // Fetch remote manifest (empty on first publish). Manifest endpoint is
    // behind authMiddleware when PASSWORD_HASH is set; pass the plaintext
    // password so the request authenticates against the worker we just deployed.
    let remoteManifest: ManifestEntity[] = [];
    if (isUpdate) {
      try {
        const client = new RemoteClient(workerUrl, plaintextPassword || undefined);
        const { entries } = await client.getManifest();
        remoteManifest = entries;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress("d1-build", `Could not fetch remote manifest (${msg}); treating as empty`);
      }
    }

    // Read all local entities once.
    const themeEngine = createGenerateThemeEngine();
    const MAX_FTS_CONTENT = 8000;
    // D1's per-statement SQL length limit is ~100-128 KB. Skip entities whose
    // serialized data alone exceeds this — their INSERT would fail SQLITE_TOOBIG.
    const MAX_ENTITY_DATA_BYTES = 80 * 1024;
    let skippedTooLarge = 0;

    type LocalRow = {
      entity: typeof entities.$inferSelect;
      colName: string;
      colCrawler: string;
    };
    const localRows: LocalRow[] = [];
    for (const colName of collectionNames) {
      const colDef = getCollection(colName)!;
      const colDb = getCollectionDb(getCollectionDbPath(colName));
      for (const entity of colDb.select().from(entities).all()) {
        localRows.push({ entity, colName, colCrawler: colDef.crawler });
      }
    }

    const localForPlan: LocalEntity[] = localRows.map(({ entity }) => ({
      externalId: entity.externalId,
      entityType: entity.entityType,
      title: entity.title,
      data: entity.data as unknown as Record<string, unknown> | string,
      contentHash: entity.contentHash ?? null,
    }));
    const plan = computeSyncPlan(localForPlan, remoteManifest);
    const changedExtIds = [
      ...plan.entities.add.map((e) => e.externalId),
      ...plan.entities.update.map((e) => e.externalId),
    ];
    const deletedExtIds = plan.entities.delete;

    onProgress(
      "d1-build",
      `Incremental plan: +${plan.entities.add.length} ~${plan.entities.update.length} -${deletedExtIds.length}`,
    );

    // Build delta SQL.
    const deltaSql: string[] = [];

    // Chunk IN(...) lists so each DELETE statement stays under MAX_BATCH_BYTES.
    const DELETE_CHUNK = 200;

    // Deletes: drop FTS rows first (no cascade), then entities rows.
    for (let i = 0; i < deletedExtIds.length; i += DELETE_CHUNK) {
      const chunk = deletedExtIds.slice(i, i + DELETE_CHUNK);
      const inList = chunk.map((id) => `'${escapeSQL(id)}'`).join(",");
      deltaSql.push(`DELETE FROM entities_fts WHERE external_id IN (${inList});`);
      deltaSql.push(`DELETE FROM entities WHERE external_id IN (${inList});`);
    }

    if (changedExtIds.length > 0) {
      // Pre-delete FTS rows for changed entities. FTS5 has no UNIQUE constraint
      // on external_id, so INSERT OR REPLACE wouldn't dedupe — explicit DELETE
      // is required before the INSERT below.
      for (let i = 0; i < changedExtIds.length; i += DELETE_CHUNK) {
        const chunk = changedExtIds.slice(i, i + DELETE_CHUNK);
        const inList = chunk.map((id) => `'${escapeSQL(id)}'`).join(",");
        deltaSql.push(`DELETE FROM entities_fts WHERE external_id IN (${inList});`);
      }

      const changedSet = new Set(changedExtIds);
      for (const { entity, colName, colCrawler } of localRows) {
        if (!changedSet.has(entity.externalId)) continue;

        const data = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);
        if (Buffer.byteLength(data, "utf8") > MAX_ENTITY_DATA_BYTES) {
          skippedTooLarge++;
          continue;
        }
        const folderVal = entity.folder != null ? `'${escapeSQL(entity.folder)}'` : "NULL";
        const slugVal = entity.slug != null ? `'${escapeSQL(entity.slug)}'` : "NULL";

        deltaSql.push(`INSERT OR REPLACE INTO entities (external_id, entity_type, title, data, content_hash, folder, slug, created_at, updated_at) VALUES ('${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(data)}', ${entity.contentHash ? `'${escapeSQL(entity.contentHash)}'` : "NULL"}, ${folderVal}, ${slugVal}, ${entity.createdAt ? `'${escapeSQL(entity.createdAt)}'` : "datetime('now')"}, ${entity.updatedAt ? `'${escapeSQL(entity.updatedAt)}'` : "datetime('now')"});`);

        const entityDataParsed: EntityData = typeof entity.data === "object" ? entity.data as EntityData : JSON.parse(entity.data as string);
        const entityTagNames = (entityDataParsed.tags ?? []).join(" ");
        let ftsContent = "";
        const hasMarkdown = entity.folder != null && entity.slug != null;
        if (hasMarkdown && themeEngine.has(colCrawler)) {
          try {
            ftsContent = themeEngine.render({
              entity: {
                externalId: entity.externalId,
                entityType: entity.entityType,
                title: entity.title,
                data: (entityDataParsed.source ?? {}) as Record<string, unknown>,
                url: entityDataParsed.url ?? undefined,
                tags: entityDataParsed.tags ?? [],
              },
              collectionName: colName,
              crawlerType: colCrawler,
            });
          } catch { /* fall back to empty content */ }
        }
        if (ftsContent.length > MAX_FTS_CONTENT) ftsContent = ftsContent.slice(0, MAX_FTS_CONTENT);

        deltaSql.push(`INSERT INTO entities_fts (entity_id, external_id, entity_type, title, content, tags) VALUES (${ftsEntityIdFor(entity.externalId)}, '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(ftsContent)}', '${escapeSQL(entityTagNames)}');`);
      }
    }

    if (skippedTooLarge > 0) {
      onProgress("d1-build", `Skipped ${skippedTooLarge} oversized entit${skippedTooLarge === 1 ? "y" : "ies"} (data > ${MAX_ENTITY_DATA_BYTES / 1024} KB)`);
    }

    if (deltaSql.length === 0) {
      onProgress("d1-upload", "No D1 changes to apply");
    } else {
      // Batch upload bounded by size (large data blobs) and count (execution time).
      // Use Buffer.byteLength for accurate UTF-8 byte count — stmt.length undercounts Unicode.
      const MAX_BATCH_BYTES = 100 * 1024;
      const MAX_BATCH_COUNT = 500;
      const batches: string[][] = [];
      let current: string[] = [];
      let currentBytes = 0;
      for (const stmt of deltaSql) {
        const stmtBytes = Buffer.byteLength(stmt, "utf8");
        if (current.length > 0 && (currentBytes + stmtBytes > MAX_BATCH_BYTES || current.length >= MAX_BATCH_COUNT)) {
          batches.push(current);
          current = [];
          currentBytes = 0;
        }
        current.push(stmt);
        currentBytes += stmtBytes;
      }
      if (current.length > 0) batches.push(current);

      const totalBatches = batches.length;
      onProgress("d1-upload", `Uploading to D1 (${totalBatches} batch${totalBatches === 1 ? "" : "es"})...`);
      let batchCount = 0;
      for (const batch of batches) {
        await executeD1Query(d1DatabaseId, batch.join("\n"));
        batchCount++;
        if (batchCount % 5 === 0 || batchCount === totalBatches) {
          onProgress("d1-upload", `Uploading to D1... ${batchCount}/${totalBatches} batches`);
        }
      }
    }

    // Upload collection config YAML to R2 (needed by new worker architecture)
    onProgress("config", "Uploading collection config to R2...");
    const collectionsList = collectionNames.map((n) => `- ${n}`).join("\n") + "\n";
    await putR2String(r2BucketName, "_config/collections.yml", collectionsList, "text/yaml");
    for (const colName of collectionNames) {
      const colConfig = getCollection(colName)!;
      const lines: string[] = [];
      lines.push(`name: ${colName}`);
      if (colConfig.title) lines.push(`title: ${colConfig.title}`);
      lines.push(`crawler: ${colConfig.crawler}`);
      if (colConfig.description) lines.push(`description: ${colConfig.description}`);
      await putR2String(r2BucketName, `_config/${colName}.yml`, lines.join("\n") + "\n", "text/yaml");
    }
  }

  if (!workerUrl) {
    workerUrl = `https://${workerName}.workers.dev`;
  }
  const mcpUrl = `${workerUrl}/mcp`;
  const passwordProtected = passwordHash.length > 0;

  if (passwordProtected && plaintextPassword) {
    saveNamedCredentials(credentialKey, { password: plaintextPassword });
  } else if (!passwordProtected) {
    removeNamedCredentials(credentialKey);
  }

  // Save publish state on the collection
  updateCollectionPublishState(collectionName, {
    url: workerUrl,
    mcpUrl,
    protected: passwordProtected,
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
  .addHelpText("after", `
Examples:
  # Publish with password protection
  fink publish my-repo --password secret123

  # Update an existing deployment (reuses stored password)
  fink publish my-repo

  # Publish without password (public access)
  fink publish my-repo --public

  # Deploy only the worker code (skip data upload)
  fink publish my-repo --worker-only

  # Set a description for MCP clients
  fink publish my-repo --password secret123 --tool-description "Team bug tracker"
`)
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
        console.log(`  claude mcp add frozenink --http \\`);
        console.log(`    --url ${result.mcpUrl} \\`);
        console.log(`    --password "<password>"`);

      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nPublish failed: ${message}`);
      process.exit(1);
    }
  });
