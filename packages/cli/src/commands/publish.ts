import { Command } from "commander";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";
import { createInterface } from "readline";
import { createHash } from "crypto";
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
  MetadataStore,
} from "@frozenink/core";
import { getPublishCredentialKey } from "./publish-credentials";
import type { EntityData } from "@frozenink/core";
import type { FolderConfig } from "@frozenink/core/theme";

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

/** Walk `content/` and collect every folder yml (content.yml at root, and
 * `{folder}/{folder}.yml` inside each subdir) into a map keyed by the
 * content-relative folder path ("" for root). */
function collectFolderYmls(
  dir: string,
  relPath: string,
  out: Record<string, FolderConfig>,
): void {
  // Root uses "content.yml"; subdirs use "{folderName}.yml"
  const folderName = relPath ? relPath.split("/").pop()! : "";
  const ymlPath = relPath
    ? join(dir, `${folderName}.yml`)
    : join(dir, "content.yml");
  if (existsSync(ymlPath)) {
    const cfg = parseFolderYml(ymlPath);
    if (Object.keys(cfg).length > 0) out[relPath] = cfg;
  }
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    collectFolderYmls(join(dir, entry.name), childRel, out);
  }
}

function parseFolderYml(ymlPath: string): FolderConfig {
  const cfg: FolderConfig = {};
  try {
    for (const line of readFileSync(ymlPath, "utf-8").split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (!m) continue;
      const [, key, val] = m;
      const v = val.trim();
      if (key === "sort") cfg.sort = v === "DESC" ? "DESC" : "ASC";
      else if (key === "visible") cfg.visible = v !== "false";
      else if (key === "showCount") cfg.showCount = v === "true";
      else if (key === "expanded") cfg.expanded = v !== "false";
      else if (key === "hide") {
        const arr = v.match(/^\[(.+)\]$/);
        if (arr) {
          cfg.hide = arr[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        }
      }
    }
  } catch { /* best effort */ }
  return cfg;
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

const META_WORKER_CONFIG_HASH = "publish.last_worker_config_hash";
const META_LOCAL_MANIFEST_HASH = "publish.last_local_manifest_hash";

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Fingerprint of the inputs that decide what the deployed worker does.
 * Includes the bundle bytes plus all fields baked into wrangler.toml.
 * Excludes the salted passwordHash (which changes every publish) — we use the
 * plaintext password presence/value instead so stable inputs hash stably.
 */
function computeWorkerConfigHash(inputs: {
  workerBundlePath: string;
  workerName: string;
  d1DatabaseName: string;
  d1DatabaseId: string;
  r2BucketName: string;
  plaintextPassword: string;
  passwordProtected: boolean;
  toolDescription?: string;
}): string {
  const bundleBytes = readFileSync(inputs.workerBundlePath);
  const bundleHash = sha256Hex(bundleBytes);
  const configJson = JSON.stringify({
    bundleHash,
    workerName: inputs.workerName,
    d1DatabaseName: inputs.d1DatabaseName,
    d1DatabaseId: inputs.d1DatabaseId,
    r2BucketName: inputs.r2BucketName,
    plaintextPassword: inputs.plaintextPassword,
    passwordProtected: inputs.passwordProtected,
    toolDescription: inputs.toolDescription ?? "",
  });
  return sha256Hex(configJson);
}

/**
 * Pack rows into one or more `<prefix> (..), (..), (..);` statements, flushing
 * when the pending buffer would exceed maxBytes. Empty rows list is a no-op.
 */
function pushMultiRowInserts(
  out: string[],
  prefix: string,
  rows: string[],
  maxBytes: number,
): void {
  if (rows.length === 0) return;
  const prefixBytes = Buffer.byteLength(prefix, "utf8");
  let buf: string[] = [];
  let bufBytes = prefixBytes;
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(row, "utf8") + 2; // ", " separator
    if (buf.length > 0 && bufBytes + rowBytes > maxBytes) {
      out.push(`${prefix}${buf.join(", ")};`);
      buf = [];
      bufBytes = prefixBytes;
    }
    buf.push(row);
    bufBytes += rowBytes;
  }
  if (buf.length > 0) out.push(`${prefix}${buf.join(", ")};`);
}

/**
 * Stable fingerprint of the local entity set. Includes folder/slug so that
 * theme-driven path changes (e.g. slug format update) trigger a D1 push even
 * when contentHash is unchanged.
 */
function computeLocalManifestHash(
  rows: Array<{ externalId: string; contentHash: string | null; folder: string | null; slug: string | null }>,
): string {
  const sorted = rows
    .map((r) => `${r.externalId}\t${r.contentHash ?? ""}\t${r.folder ?? ""}\t${r.slug ?? ""}`)
    .sort();
  return sha256Hex(sorted.join("\n"));
}

// --- Reusable publish function ---

export interface PublishOptions {
  collectionName: string;
  toolDescription?: string;
  password?: string;
  removePassword?: boolean;
  forcePublic?: boolean;
  workerOnly?: boolean;
  /**
   * Force a full D1 rebuild: bypass the manifest-hash short-circuit and treat
   * every local entity as "push". Needed after theme path changes (folder/slug
   * moves) because those don't alter contentHash and the incremental plan
   * wouldn't pick them up.
   */
  full?: boolean;
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

  const { collectionName, removePassword = false, forcePublic = false, full = false } = options;
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

  // Open the collection metadata store — used for cross-publish caching
  // (worker-config hash to skip redeploy, local-manifest hash to skip D1 push).
  const collectionDbPath = getCollectionDbPath(collectionName);
  const meta = existsSync(collectionDbPath) ? new MetadataStore(collectionDbPath) : null;

  // --- Phase 1: Create infrastructure + deploy worker ---

  if (!workerOnly) {
    onProgress("d1", "Setting up D1 database...");
    const d1 = await createD1(d1DatabaseName);
    d1DatabaseId = d1.uuid;
    onProgress("d1", `D1 database: ${d1DatabaseName} (${d1DatabaseId})`);
  }

  onProgress("r2", "Setting up R2 bucket...");
  await createR2Bucket(r2BucketName);

  const workerConfigHash = computeWorkerConfigHash({
    workerBundlePath,
    workerName,
    d1DatabaseName,
    d1DatabaseId,
    r2BucketName,
    plaintextPassword,
    passwordProtected: passwordHash.length > 0,
    toolDescription,
  });
  const storedWorkerConfigHash = isUpdate ? meta?.getOptional(META_WORKER_CONFIG_HASH) : null;
  const canSkipDeploy = isUpdate && storedWorkerConfigHash === workerConfigHash && !!existingPublish?.url;

  let workerUrl = "";
  if (canSkipDeploy) {
    workerUrl = existingPublish!.url;
    onProgress("deploy", "Worker bundle + config unchanged — skipping redeploy");
  } else {
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
    try {
      workerUrl = await deployWorker(tomlFile);
    } finally {
      cleanupTempFile(tomlFile);
    }
    // Wrangler doesn't always echo the URL on re-deploys — fall back to the
    // previously-saved URL (or the default workers.dev hostname) so downstream
    // requests like the manifest fetch in Phase 3 always have a real base URL.
    if (!workerUrl) {
      workerUrl = existingPublish?.url || `https://${workerName}.workers.dev`;
    }
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
    // Fetch existing R2 objects once — used for both upload skipping and stale cleanup.
    // We track both size and etag (MD5): size alone can't detect content changes when
    // length is coincidentally identical (e.g. an index.html whose asset hash string
    // changes but stays the same byte length).
    const existingR2Objects = new Map<string, { size: number; etag: string }>();
    if (isUpdate) {
      try {
        onProgress("r2-list", "Listing existing R2 objects...");
        const remoteObjects = await listR2Objects(r2BucketName);
        for (const obj of remoteObjects) existingR2Objects.set(obj.key, { size: obj.size, etag: obj.etag });
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
      // Upload the sibling attachments/ directory — the worker serves these at
      // /api/attachments/{name}/* and the UI rewrites markdown image paths to
      // that endpoint. Without this, embedded images 404 on the published site.
      const attachmentsDir = join(collectionDir, "attachments");
      if (existsSync(attachmentsDir)) {
        for (const file of collectFiles(attachmentsDir)) {
          uploads.push({ r2Key: `${colName}/attachments/${file.relativePath}`, fullPath: file.fullPath });
        }
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
      const existing = existingR2Objects.get(r2Key);
      let skip = false;
      if (existing && existing.size === localSize) {
        const localMd5 = createHash("md5").update(readFileSync(fullPath)).digest("hex");
        if (localMd5 === existing.etag) skip = true;
      }
      if (skip) skippedCount++;
      else toUpload.push({ r2Key, fullPath });
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

    // Stale cleanup: remove R2 keys no longer in the local set.
    // Skip `_config/` — those files are uploaded later in Phase 3 (not tracked
    // in `fileSizes`), so without this guard they'd be deleted here and only
    // re-created if Phase 3 reaches the config-upload step. A crash mid-publish
    // would leave the worker with no _config/collections.yml, which makes
    // /api/collections return [] and breaks remote clones.
    // Skip `_cache/` — worker-managed manifest cache invalidated explicitly
    // in Phase 3 after the D1 rebuild.
    let deletedCount = 0;
    if (isUpdate) {
      const allKeys = new Set(fileSizes.keys());
      try {
        const staleKeys = [...existingR2Objects.keys()].filter(
          (key) => !allKeys.has(key) && !key.startsWith("_config/") && !key.startsWith("_cache/"),
        );
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

  let newLocalManifestHash: string | null = null;

  if (!workerOnly) {
    onProgress("d1-build", "Computing incremental plan...");

    // Read all local entities once.
    const themeEngine = createGenerateThemeEngine();
    const MAX_FTS_CONTENT = 8000;
    // D1's per-statement SQL length limit is ~100-128 KB. Entities whose
    // serialized data alone exceeds this can never be pushed — their INSERT
    // would fail SQLITE_TOOBIG. Filter them out of the plan entirely so they
    // don't keep showing up as "+1 to push" forever on every re-publish.
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
        const dataStr = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);
        if (Buffer.byteLength(dataStr, "utf8") > MAX_ENTITY_DATA_BYTES) {
          skippedTooLarge++;
          continue;
        }
        localRows.push({ entity, colName, colCrawler: colDef.crawler });
      }
    }
    if (skippedTooLarge > 0) {
      onProgress(
        "d1-build",
        `Skipped ${skippedTooLarge} oversized entit${skippedTooLarge === 1 ? "y" : "ies"} (data > ${MAX_ENTITY_DATA_BYTES / 1024} KB)`,
      );
    }

    // Fast-path: if the local entity set is identical to what we last pushed,
    // skip the entire D1 phase (schema init + manifest fetch + plan + upload +
    // cache invalidation). The stored hash is only set after a successful push,
    // so this is safe to trust without round-tripping /info.
    newLocalManifestHash = computeLocalManifestHash(
      localRows.map(({ entity }) => ({
        externalId: entity.externalId,
        contentHash: entity.contentHash ?? null,
        folder: entity.folder ?? null,
        slug: entity.slug ?? null,
      })),
    );
    const storedLocalManifestHash = isUpdate ? meta?.getOptional(META_LOCAL_MANIFEST_HASH) : null;
    if (!full && storedLocalManifestHash && storedLocalManifestHash === newLocalManifestHash) {
      onProgress("d1-build", "Local manifest unchanged since last publish — skipping D1 rebuild");
    } else {
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

      const localForPlan: LocalEntity[] = localRows.map(({ entity }) => ({
        externalId: entity.externalId,
        entityType: entity.entityType,
        title: entity.title,
        data: entity.data as unknown as Record<string, unknown> | string,
        contentHash: entity.contentHash ?? null,
      }));
      const plan = computeSyncPlan(localForPlan, remoteManifest);
      // Invert pull semantics into push semantics: computeSyncPlan returns
      //   add    = remote-only (pull would download these)
      //   update = both, hash differs
      //   delete = local-only (pull would remove these locally)
      // For publish we instead need:
      //   push:   local-only + hash-differs   → INSERT OR REPLACE on remote
      //   prune:  remote-only                 → DELETE on remote
      // --full forces every local entity into the push set so folder/slug
      // (and other non-content-hash) changes propagate to D1.
      const pushExtIds = full
        ? localRows.map((r) => r.entity.externalId)
        : [
            ...plan.entities.delete,
            ...plan.entities.update.map((e) => e.externalId),
          ];
      const pruneExtIds = plan.entities.add.map((e) => e.externalId);

      onProgress(
        "d1-build",
        full
          ? `Full rebuild: ${pushExtIds.length} pushed, ${pruneExtIds.length} pruned`
          : `Incremental plan: +${plan.entities.delete.length} ~${plan.entities.update.length} -${pruneExtIds.length}`,
      );

      // Two-phase SQL: all DELETEs before any INSERTs, so batches can run in
      // parallel without risking an INSERT racing its own pre-delete.
      const deleteSql: string[] = [];
      const insertSql: string[] = [];

      // Chunk IN(...) lists so each DELETE statement stays under MAX_BATCH_BYTES.
      const DELETE_CHUNK = 200;

      // Prune entries that exist remotely but not locally — drop FTS rows
      // first (no cascade), then entities rows.
      const allDeleteIds = [...pruneExtIds, ...pushExtIds];
      for (let i = 0; i < allDeleteIds.length; i += DELETE_CHUNK) {
        const chunk = allDeleteIds.slice(i, i + DELETE_CHUNK);
        const inList = chunk.map((id) => `'${escapeSQL(id)}'`).join(",");
        deleteSql.push(`DELETE FROM entities_fts WHERE external_id IN (${inList});`);
        deleteSql.push(`DELETE FROM entities WHERE external_id IN (${inList});`);
      }

      if (pushExtIds.length > 0) {
        const pushSet = new Set(pushExtIds);
        const entityValueRows: string[] = [];
        const ftsValueRows: string[] = [];

        for (const { entity, colName, colCrawler } of localRows) {
          if (!pushSet.has(entity.externalId)) continue;

          const data = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);
          const folderVal = entity.folder != null ? `'${escapeSQL(entity.folder)}'` : "NULL";
          const slugVal = entity.slug != null ? `'${escapeSQL(entity.slug)}'` : "NULL";

          entityValueRows.push(
            `('${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(data)}', ${entity.contentHash ? `'${escapeSQL(entity.contentHash)}'` : "NULL"}, ${folderVal}, ${slugVal}, ${entity.createdAt ? `'${escapeSQL(entity.createdAt)}'` : "datetime('now')"}, ${entity.updatedAt ? `'${escapeSQL(entity.updatedAt)}'` : "datetime('now')"})`,
          );

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

          ftsValueRows.push(
            `(${ftsEntityIdFor(entity.externalId)}, '${escapeSQL(entity.externalId)}', '${escapeSQL(entity.entityType)}', '${escapeSQL(entity.title)}', '${escapeSQL(ftsContent)}', '${escapeSQL(entityTagNames)}')`,
          );
        }

        // Group rows into multi-row INSERTs to cut per-statement overhead.
        // Bounded by byte size per INSERT to stay under D1's statement limit.
        const MAX_INSERT_BYTES = 80 * 1024;
        const entityPrefix = "INSERT OR REPLACE INTO entities (external_id, entity_type, title, data, content_hash, folder, slug, created_at, updated_at) VALUES ";
        const ftsPrefix = "INSERT INTO entities_fts (entity_id, external_id, entity_type, title, content, tags) VALUES ";
        pushMultiRowInserts(insertSql, entityPrefix, entityValueRows, MAX_INSERT_BYTES);
        pushMultiRowInserts(insertSql, ftsPrefix, ftsValueRows, MAX_INSERT_BYTES);
      }

      // Pack each phase into size-bounded batches, then execute each phase
      // with bounded concurrency. Deletes always finish before any inserts.
      const MAX_BATCH_BYTES = 100 * 1024;
      const MAX_BATCH_COUNT = 500;
      const D1_CONCURRENCY = 4;

      async function runPhase(phaseSql: string[], label: string) {
        if (phaseSql.length === 0) return;
        const batches: string[][] = [];
        let current: string[] = [];
        let currentBytes = 0;
        for (const stmt of phaseSql) {
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

        const total = batches.length;
        onProgress("d1-upload", `${label}: ${total} batch${total === 1 ? "" : "es"} (concurrency ${Math.min(D1_CONCURRENCY, total)})...`);
        let done = 0;
        await runConcurrent(batches, D1_CONCURRENCY, async (batch) => {
          await executeD1Query(d1DatabaseId, batch.join("\n"));
          done++;
          if (done % 5 === 0 || done === total) {
            onProgress("d1-upload", `${label}... ${done}/${total} batches`);
          }
        });
      }

      if (deleteSql.length === 0 && insertSql.length === 0) {
        onProgress("d1-upload", "No D1 changes to apply");
      } else {
        await runPhase(deleteSql, "D1 deletes");
        await runPhase(insertSql, "D1 inserts");
      }
    }

    // Invalidate cached manifests and info blobs so the next client request
    // rebuilds from the fresh D1 state. Info cache keys include the worker
    // build ID, so we list and filter rather than guessing.
    const cacheKeys: string[] = collectionNames.map((n) => `_cache/manifest-${n}.json`);
    try {
      const cached = await listR2Objects(r2BucketName, "_cache/");
      for (const obj of cached) {
        for (const n of collectionNames) {
          if (obj.key.startsWith("_cache/info-") && obj.key.endsWith(`-${n}.json`)) {
            cacheKeys.push(obj.key);
          }
        }
      }
    } catch {
      // Listing is best-effort; manifest cache invalidation still proceeds below.
    }
    try {
      await deleteR2Objects(r2BucketName, cacheKeys);
    } catch {
      // Non-fatal — stale cache just means clients get slightly outdated data
      // until the next publish. Better than failing the whole publish.
      onProgress("r2-cleanup", "Warning: could not invalidate manifest cache");
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

      // Aggregate all content/*.yml folder configs (content.yml + per-subdir yml)
      // into a single JSON the worker can read in one R2 fetch when building the
      // tree. Worker has no `node:fs` and we want to avoid N+1 reads per request.
      const contentDir = join(home, "collections", colName, "content");
      const folderConfigs: Record<string, FolderConfig> = {};
      if (existsSync(contentDir)) {
        collectFolderYmls(contentDir, "", folderConfigs);
      }
      await putR2String(
        r2BucketName,
        `_config/${colName}-folders.json`,
        JSON.stringify(folderConfigs),
        "application/json",
      );
    }
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

  // Persist hashes for the next publish's fast-paths.
  if (meta) {
    meta.set(META_WORKER_CONFIG_HASH, workerConfigHash);
    if (newLocalManifestHash) meta.set(META_LOCAL_MANIFEST_HASH, newLocalManifestHash);
    meta.close();
  }

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
  .option("--full", "Force full D1 rebuild (push every entity, bypass manifest/incremental-hash short-circuit). Use after theme path changes.")
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
    full?: boolean;
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
          full: !!opts.full,
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
