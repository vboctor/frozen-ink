import { Command } from "commander";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, extname } from "path";
import { createInterface } from "readline";
import {
  getFrozenInkHome,
  getCollectionDb,
  openDatabase,
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
} from "@frozenink/core";
import type { EntityData } from "@frozenink/core";

const __moduleDir = getModuleDir(import.meta.url);
import { assertInitialPublishConfirmation } from "./publish-policy";
import { createGenerateThemeEngine } from "./generate";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Format a value read from SQLite as a SQL literal for use in a dump. */
function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (v instanceof Uint8Array) return "X'" + Buffer.from(v).toString("hex").toUpperCase() + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
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
    if (col.crawler === "remote") {
      throw new Error(`Cannot publish "${collectionName}": crawler is "remote". Remote collections are read-only clones.`);
    }
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
        const staleKeys = [...existingR2Objects.keys()].filter((key) => !allKeys.has(key) && !key.endsWith("/db-digest"));
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

  // --- Phase 3: D1 rebuild (destructive — done last to minimize downtime) ---

  let dbDigest = "";
  if (!workerOnly) {
    const dbPath = getCollectionDbPath(collectionName);

    // Run migration before hashing so the digest reflects the post-migration schema.
    // If folder/slug columns were just added (backfilled from data.markdown_path),
    // the DB content changes and won't match the pre-migration remote digest,
    // forcing a full D1 rebuild with the correct schema.
    const colDbForDigest = getCollectionDb(dbPath);
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

      // Build a temp SQLite DB with the target schema using prepared statements
      // (no manual string escaping), then dump it to SQL for D1 upload.
      const tmpDbPath = join(process.env.TMPDIR || "/tmp", `fink-d1-${randomSuffix()}.db`);
      let tmpDb: any = null;
      const schemaSql: string[] = [];
      try {
        tmpDb = openDatabase(tmpDbPath);

        const D1_DDL = [
          "DROP TABLE IF EXISTS entities_fts;",
          "DROP TABLE IF EXISTS entities;",
          "DROP TABLE IF EXISTS collections_meta;",
          `CREATE TABLE entities (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  title TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT, folder TEXT, slug TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`,
          "CREATE INDEX idx_entities_external ON entities(external_id);",
          "CREATE INDEX idx_entities_folder   ON entities(folder, slug);",
          "CREATE INDEX idx_entities_type     ON entities(entity_type);",
          "CREATE INDEX idx_entities_updated  ON entities(updated_at);",
          "CREATE VIRTUAL TABLE entities_fts USING fts5(entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags);",
        ];
        for (const stmt of D1_DDL) {
          // Apply schema to temp DB and include in upload SQL
          if (!stmt.startsWith("DROP")) tmpDb.exec(stmt);
          schemaSql.push(stmt);
        }

        const insertEntity = tmpDb.prepare(
          "INSERT INTO entities (id, external_id, entity_type, title, data, content_hash, folder, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        const insertFts = tmpDb.prepare(
          "INSERT INTO entities_fts (entity_id, external_id, entity_type, title, content, tags) VALUES (?, ?, ?, ?, ?, ?)",
        );

        const themeEngine = createGenerateThemeEngine();
        const MAX_FTS_CONTENT = 8000;
        let entityIdOffset = 0;

        for (const colName of collectionNames) {
          const col = getCollection(colName)!;
          const colDb = colName === collectionName ? colDbForDigest : getCollectionDb(getCollectionDbPath(colName));
          const allEntities = colDb.select().from(entities).all();

          for (const entity of allEntities) {
            entityIdOffset++;
            const data = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);

            insertEntity.run(
              entityIdOffset, entity.externalId, entity.entityType, entity.title,
              data, entity.contentHash ?? null, entity.folder ?? null, entity.slug ?? null,
              entity.createdAt ?? null, entity.updatedAt ?? null,
            );

            const entityDataParsed: EntityData = typeof entity.data === "object" ? entity.data as EntityData : JSON.parse(entity.data as string);
            const entityTagNames = (entityDataParsed.tags ?? []).join(" ");
            let ftsContent = "";
            const hasMarkdown = entity.folder != null && entity.slug != null;
            if (hasMarkdown && themeEngine.has(col.crawler)) {
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
                  crawlerType: col.crawler,
                });
              } catch { /* fall back to empty content */ }
            }
            if (ftsContent.length > MAX_FTS_CONTENT) ftsContent = ftsContent.slice(0, MAX_FTS_CONTENT);

            insertFts.run(entityIdOffset, entity.externalId, entity.entityType, entity.title, ftsContent, entityTagNames);
          }

          onProgress("d1-build", `Built "${colName}": ${allEntities.length} entities`);
        }

        // Dump temp DB rows to SQL statements
        const entityRows: Record<string, unknown>[] = tmpDb.prepare("SELECT * FROM entities").all();
        for (const row of entityRows) {
          schemaSql.push(`INSERT INTO entities VALUES (${Object.values(row).map(sqlLiteral).join(", ")});`);
        }
        const ftsRows: Record<string, unknown>[] = tmpDb.prepare(
          "SELECT entity_id, external_id, entity_type, title, content, tags FROM entities_fts",
        ).all();
        for (const row of ftsRows) {
          schemaSql.push(`INSERT INTO entities_fts (entity_id, external_id, entity_type, title, content, tags) VALUES (${Object.values(row).map(sqlLiteral).join(", ")});`);
        }
      } finally {
        tmpDb?.close();
        try { unlinkSync(tmpDbPath); } catch { /* ignore cleanup errors */ }
      }

      // Upload in batches bounded by both size (large data blobs) and count (execution time).
      // Use Buffer.byteLength for accurate UTF-8 byte count — stmt.length undercounts Unicode.
      const MAX_BATCH_BYTES = 100 * 1024; // 100 KB — conservative against D1's SQL length limit
      const MAX_BATCH_COUNT = 500;
      const batches: string[][] = [];
      let current: string[] = [];
      let currentBytes = 0;
      for (const stmt of schemaSql) {
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
      onProgress("d1-upload", `Uploading to D1 (${totalBatches} batches)...`);
      let batchCount = 0;
      for (const batch of batches) {
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
