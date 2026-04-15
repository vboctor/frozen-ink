import { Command } from "commander";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import { createInterface } from "readline";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  getCollection,
  updateCollection,
  getCollectionDbPath,
  addSite,
  getSite,
  entities,
  getModuleDir,
  resolveWorkerBundle,
  resolveUiDist,
} from "@frozenink/core";

import { eq } from "drizzle-orm";
const __moduleDir = getModuleDir(import.meta.url);
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
  collectionNames: string[];
  workerName: string;
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
  collections: string[];
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

function deriveToolDescriptionFromCollections(collectionNames: string[]): string | undefined {
  const descriptions = collectionNames
    .map((name) => getCollection(name)?.mcpToolDescription?.trim())
    .filter((value): value is string => !!value);

  if (descriptions.length === 0) return undefined;
  return descriptions.join(" | ");
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
    deployWorker,
    generateWranglerToml,
    writeTempFile,
    cleanupTempFile,
  } = await import("./wrangler-api");

  await checkWranglerAuth();

  const { workerName, workerOnly = false, removePassword = false, forcePublic = false } = options;
  let toolDescription = options.toolDescription?.trim() || undefined;
  const password = options.password?.trim();
  if (password && removePassword) {
    throw new Error("Cannot use --password and --remove-password together.");
  }
  let collectionNames = [...options.collectionNames];

  const existingSite = getSite(workerName);
  const isUpdate = !!existingSite;

  if (workerOnly && !existingSite) {
    throw new Error(`Site "${workerName}" not found. --worker-only only works for existing sites.`);
  }

  if (workerOnly && existingSite) {
    collectionNames = existingSite.collections;
    if (!toolDescription) {
      toolDescription = existingSite.toolDescription;
    }
  }

  const home = getFrozenInkHome();

  // Validate collections
  if (!workerOnly) {
    for (const name of collectionNames) {
      const col = getCollection(name);
      if (!col) throw new Error(`Collection "${name}" not found`);
      const dbPath = getCollectionDbPath(name);
      if (!existsSync(dbPath)) throw new Error(`Collection "${name}" database not found at ${dbPath}`);
    }
  }

  let d1DatabaseName: string;
  let d1DatabaseId: string;
  let r2BucketName: string;
  if (workerOnly) {
    const site = existingSite!;
    d1DatabaseName = site.database.name || `${workerName}-db`;
    d1DatabaseId = site.database.id;
    r2BucketName = site.bucket.name;
  } else {
    d1DatabaseName = `${workerName}-db`;
    d1DatabaseId = "";
    r2BucketName = `${workerName}-files`;
  }

  // Password behavior:
  // - New password supplied: rotate hash.
  // - removePassword=true: clear protection.
  // - Otherwise preserve existing hash on updates.
  let passwordHash = "";
  if (password) {
    passwordHash = await hashPassword(password);
  } else if (removePassword) {
    passwordHash = "";
  } else if (existingSite?.password?.hash) {
    passwordHash = existingSite.password.hash;
  } else if (isUpdate && existingSite?.password?.protected) {
    throw new Error(
      `Site "${workerName}" is password protected but no reusable password hash is stored locally. ` +
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

  // List existing R2 keys for stale file cleanup on updates
  let existingR2Keys = new Set<string>();
  if (!workerOnly && isUpdate) {
    try {
      const { listR2Objects } = await import("./wrangler-api");
      onProgress("r2-list", "Listing existing R2 objects...");
      const keys = await listR2Objects(r2BucketName);
      for (const key of keys) existingR2Keys.add(key);
    } catch {
      // May fail on first publish or if bucket doesn't exist yet
    }
  }

  if (!workerOnly) {
    onProgress("export", "Building database export...");
    const schemaSql: string[] = [];

    schemaSql.push("DROP TABLE IF EXISTS entities_fts;");
    schemaSql.push("DROP TABLE IF EXISTS r2_manifest;");
    schemaSql.push("DROP TABLE IF EXISTS entities;");
    schemaSql.push("DROP TABLE IF EXISTS collections_meta;");
    schemaSql.push("");
    schemaSql.push(`CREATE TABLE entities (
  id INTEGER PRIMARY KEY, collection_name TEXT NOT NULL,
  external_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  title TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT, markdown_path TEXT,
  markdown_mtime REAL, markdown_size INTEGER,
  url TEXT,
  tags TEXT, out_links TEXT, in_links TEXT, assets TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
    schemaSql.push("CREATE INDEX idx_entities_collection ON entities(collection_name);");
    schemaSql.push("CREATE INDEX idx_entities_external ON entities(collection_name, external_id);");
    schemaSql.push("");

    let entityIdOffset = 0;
    const MAX_DATA_LEN = 50000;

    for (const colName of collectionNames) {
      const col = getCollection(colName)!;
      const dbPath = getCollectionDbPath(colName);
      const colDb = getCollectionDb(dbPath);
      const title = col.title || colName;

      const allEntities = colDb.select().from(entities).all();

      for (const entity of allEntities) {
        entityIdOffset++;
        let data = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);
        if (data.length > MAX_DATA_LEN) data = data.slice(0, MAX_DATA_LEN);

        const tagsJson = JSON.stringify((entity as any).tags ?? []);
        const outLinksJson = JSON.stringify((entity as any).outLinks ?? []);
        const inLinksJson = JSON.stringify((entity as any).inLinks ?? []);
        const assetsJson = JSON.stringify((entity as any).assets ?? []);

        schemaSql.push(`INSERT INTO entities (id, collection_name, external_id, entity_type, title, data, content_hash, markdown_path, markdown_mtime, markdown_size, url, tags, out_links, in_links, assets, created_at, updated_at) VALUES (${entityIdOffset}, '${escapeSQL(colName)}', '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(data)}', ${entity.contentHash ? `'${escapeSQL(entity.contentHash)}'` : "NULL"}, ${entity.markdownPath ? `'${escapeSQL(entity.markdownPath)}'` : "NULL"}, ${entity.markdownMtime ?? "NULL"}, ${entity.markdownSize ?? "NULL"}, ${entity.url ? `'${escapeSQL(entity.url)}'` : "NULL"}, '${escapeSQL(tagsJson)}', '${escapeSQL(outLinksJson)}', '${escapeSQL(inLinksJson)}', '${escapeSQL(assetsJson)}', ${entity.createdAt ? `'${escapeSQL(entity.createdAt)}'` : "datetime('now')"}, ${entity.updatedAt ? `'${escapeSQL(entity.updatedAt)}'` : "datetime('now')"});`);
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

    for (const colName of collectionNames) {
      const dbPath = getCollectionDbPath(colName);
      const colDb = getCollectionDb(dbPath);
      const allEntities = colDb.select().from(entities).all();
      const collectionDir = join(home, "collections", colName);

      for (const entity of allEntities) {
        let content = "";
        if (entity.markdownPath) {
          const mdPath = join(collectionDir, "content", entity.markdownPath);
          if (existsSync(mdPath)) {
            content = readFileSync(mdPath, "utf-8");
          }
        }
        if (content.length > MAX_FTS_CONTENT) {
          content = content.slice(0, MAX_FTS_CONTENT);
        }
        const entityTagNames = ((entity as any).tags ?? []).join(" ");

        ftsSql.push(`INSERT INTO entities_fts (collection_name, entity_id, external_id, entity_type, title, content, tags) VALUES ('${escapeSQL(colName)}', ${entity.id}, '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(content)}', '${escapeSQL(entityTagNames)}');`);
      }
    }

    onProgress("fts-upload", "Uploading search index to D1...");
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
      await runConcurrent(uiUploads, 10, async ({ r2Key, fullPath }) => {
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

    onProgress("r2-upload", `Uploading ${uploads.length} files to R2...`);
    const uploadedKeys = new Set<string>();
    let uploadCount = 0;
    await runConcurrent(uploads, 10, async ({ r2Key, fullPath }) => {
      await putR2Object(r2BucketName, r2Key, fullPath, getMimeType(fullPath));
      uploadedKeys.add(r2Key);
      uploadCount++;
      if (uploadCount % 50 === 0) {
        onProgress("r2-upload", `${uploadCount}/${uploads.length} files uploaded...`);
      }
    });
    onProgress("r2-upload", `Uploaded ${uploadCount} files to R2`);

    if (isUpdate && existingR2Keys.size > 0) {
      const staleKeys = [...existingR2Keys].filter((key) => !uploadedKeys.has(key));
      if (staleKeys.length > 0) {
        onProgress("r2-cleanup", `Removing ${staleKeys.length} stale file(s)...`);
        await runConcurrent(staleKeys, 10, async (key) => deleteR2Object(r2BucketName, key));
      }
    }

    // Upload YAML collection config to R2
    const { putR2ObjectFromString } = await import("./wrangler-api");
    onProgress("config", "Uploading collection config to R2...");
    const collectionsList = collectionNames.map((n) => `- ${n}`).join("\n") + "\n";
    await putR2ObjectFromString(r2BucketName, "_config/collections.yml", collectionsList, "text/yaml");
    for (const colName of collectionNames) {
      const col = getCollection(colName)!;
      const lines: string[] = [];
      lines.push(`name: ${colName}`);
      if (col.title) lines.push(`title: ${col.title}`);
      lines.push(`crawler: ${col.crawler}`);
      if (col.description) lines.push(`description: ${col.description}`);
      await putR2ObjectFromString(r2BucketName, `_config/${colName}.yml`, lines.join("\n") + "\n", "text/yaml");
    }
  }

  if (!workerUrl) {
    workerUrl = `https://${workerName}.workers.dev`;
  }
  const mcpUrl = `${workerUrl}/mcp`;
  const passwordProtected = passwordHash.length > 0;

  // Update lastPublishedAt in each collection's YAML
  if (!workerOnly) {
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    for (const colName of collectionNames) {
      updateCollection(colName, { lastPublishedAt: now });
    }
  }

  // Save site
  addSite(workerName, {
    url: workerUrl,
    mcpUrl,
    toolDescription,
    collections: collectionNames,
    database: { type: "cloudflare-d1", id: d1DatabaseId, name: d1DatabaseName },
    bucket: { type: "cloudflare-r2", name: r2BucketName },
    password: { protected: passwordProtected, hash: passwordHash || undefined },
    publishedAt: new Date().toISOString(),
  });

  onProgress("done", "Publish completed");

  return {
    workerName,
    workerUrl,
    mcpUrl,
    toolDescription,
    collections: collectionNames,
    isUpdate,
    workerOnly,
  };
}

// --- CLI command ---

export const publishCommand = new Command("publish")
  .description("Publish collections to Cloudflare as a password-protected website with MCP access")
  .argument("[collections...]", "Collection names to publish")
  .option("--password <password>", "Password to protect access")
  .option("--remove-password", "Explicitly remove password protection")
  .option("--public", "Explicitly allow public access on initial publish (skip confirmation prompt)")
  .option("--tool-description <description>", "Tool description advertised to MCP clients")
  .option("--name <name>", "Worker name (default: fink-<first-collection>-<random>)")
  .option("--worker-only", "Deploy worker code only (skip D1/R2 data upload); requires --name for an existing deployment")
  .action(async (collectionNamesArg: string[], opts: {
    password?: string;
    removePassword?: boolean;
    public?: boolean;
    toolDescription?: string;
    name?: string;
    workerOnly?: boolean;
  }) => {
    try {
      ensureInitialized();

      const workerOnly = !!opts.workerOnly;
      const collectionNames = collectionNamesArg ?? [];

      if (!workerOnly && collectionNames.length === 0) {
        console.error("No collections specified. Provide at least one collection name.");
        process.exit(1);
      }
      if (workerOnly && !opts.name) {
        console.error("--worker-only requires --name <deployment-name>.");
        process.exit(1);
      }

      const workerName = opts.name || `fink-${collectionNames[0]}-${randomSuffix()}`;
      let forcePublic = !!opts.public;
      let toolDescription = opts.toolDescription?.trim() || undefined;

      if (!forcePublic && !opts.password && !workerOnly) {
        const existingSite = getSite(workerName);
        const isInitialPublish = !existingSite;
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
        const derived = deriveToolDescriptionFromCollections(collectionNames);
        toolDescription = await promptToolDescription(derived);
      }

      const result = await publishCollections(
        {
          collectionNames,
          workerName,
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
        : `${result.collections.length} collection(s) to Cloudflare`;
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
