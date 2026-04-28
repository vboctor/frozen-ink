import { existsSync } from "fs";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  getCollection,
  getCollectionDbPath,
  entities,
  LocalStorageBackend,
  SearchIndexer,
  MetadataStore,
  entityMarkdownPath,
  splitMarkdownPath,
  resolveCredentials,
} from "@frozenink/core";
import type { EntityData } from "@frozenink/core";
import { eq } from "drizzle-orm";
import { RemoteClient } from "./remote-client";
import {
  computeSyncPlan,
  printSyncPlan,
  isSyncPlanEmpty,
  assertSafePath,
  type LocalEntity,
  type RemoteEntityData,
} from "./sync-plan";

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

export interface PullCollectionOptions {
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

export interface PullCollectionResult {
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Pull updates from a remote published site into a cloned collection.
 * The collection must exist and have crawler === "remote".
 */
export async function pullCollection(collectionName: string, opts: PullCollectionOptions = {}): Promise<PullCollectionResult> {
  ensureInitialized();
  const home = getFrozenInkHome();
  const log = opts.onProgress ?? ((msg: string) => console.log(msg));

  const col = getCollection(collectionName);
  if (!col) {
    throw new Error(`Collection "${collectionName}" not found`);
  }

  if (col.crawler !== "remote") {
    throw new Error(`Collection "${collectionName}" is not a remote clone (crawler: ${col.crawler})`);
  }

  const sourceUrl = (col.config as any)?.sourceUrl;
  if (!sourceUrl) {
    throw new Error(`Collection "${collectionName}" has no sourceUrl in config`);
  }

  const resolved = resolveCredentials(col.credentials);
  const password = (resolved as any)?.password;
  const client = new RemoteClient(sourceUrl, password);

  const dbPath = getCollectionDbPath(collectionName);
  if (!existsSync(dbPath)) {
    throw new Error(`Collection "${collectionName}" database not found. Run 'fink clone' first.`);
  }

  const colDb = getCollectionDb(dbPath);
  const collectionDir = join(home, "collections", collectionName);
  const storage = new LocalStorageBackend(collectionDir);

  // Fast-path: ask /info for the remote manifest hash and compare to the hash
  // stored from the last successful sync. If they match, nothing has changed
  // and we can skip the full manifest download + sync-plan computation.
  // Falls back to the manifest flow if /info is unavailable (older worker) or
  // no hash is stored locally yet.
  const meta = new MetadataStore(dbPath);
  const localManifestHash = meta.getRemoteManifestHash();
  let remoteManifestHash: string | null = null;
  try {
    const info = await client.getInfo();
    remoteManifestHash = info.manifestHash ?? null;
    if (info.crawlerType) meta.setCrawlerType(info.crawlerType);
    if (localManifestHash && remoteManifestHash && localManifestHash === remoteManifestHash) {
      meta.close();
      log("Already up to date.");
      return { created: 0, updated: 0, deleted: 0 };
    }
  } catch (err) {
    // Older workers won't have /info — fall back to the manifest path below.
    if (!(err instanceof Error) || !err.message.startsWith("HTTP 404 ")) {
      meta.close();
      throw err;
    }
  }

  // Fetch remote manifest
  log("Fetching manifest...");
  const { manifest, entries } = await client.getManifest();

  // Keep crawler.type in sync — repairs clones created before this field existed
  if (manifest.collection?.crawlerType) {
    meta.setCrawlerType(manifest.collection.crawlerType);
  }

  // Build local entity list
  const allLocal = colDb.select().from(entities).all();
  const localEntities: LocalEntity[] = allLocal.map((e: any) => ({
    externalId: e.externalId,
    entityType: e.entityType,
    title: e.title,
    data: e.data as unknown as EntityData,
    contentHash: e.contentHash,
    markdownPath: entityMarkdownPath(e.folder, e.slug),
  }));

  // Compute sync plan
  const plan = computeSyncPlan(localEntities, entries);

  if (isSyncPlanEmpty(plan)) {
    // Persist the hash so the next /info fast-path short-circuits even if the
    // local DB predated the manifestHash feature.
    if (remoteManifestHash) meta.setRemoteManifestHash(remoteManifestHash);
    meta.close();
    log("Already up to date.");
    return { created: 0, updated: 0, deleted: 0 };
  }

  printSyncPlan(plan);

  if (opts.dryRun) {
    meta.close();
    return { created: plan.entities.add.length, updated: plan.entities.update.length, deleted: plan.entities.delete.length };
  }

  // Fetch full data for added and updated entities
  const fetchIds = [
    ...plan.entities.add.map((e) => e.externalId),
    ...plan.entities.update.map((e) => e.externalId),
  ];

  let remoteEntities: RemoteEntityData[] = [];
  if (fetchIds.length > 0) {
    log(`Fetching ${fetchIds.length} entities...`);
    remoteEntities = await client.getEntitiesBulk(fetchIds);
  }
  const remoteByExtId = new Map<string, RemoteEntityData>();
  for (const re of remoteEntities) {
    remoteByExtId.set(re.externalId, re);
  }

  // Execute file moves first (no network)
  for (const move of plan.files.move) {
    assertSafePath(move.from);
    assertSafePath(move.to);
    try {
      const content = await storage.read(`content/${move.from}`);
      await storage.write(`content/${move.to}`, content);
      await storage.delete(`content/${move.from}`);
    } catch {
      // Fall through — will be re-downloaded
    }
  }

  // Download new/updated markdown files
  const mdDownloads = remoteEntities.filter((e) => e.markdownPath);
  if (mdDownloads.length > 0) {
    log(`Downloading ${mdDownloads.length} files...`);
    await runConcurrent(mdDownloads, 10, async (re) => {
      const mdPath = re.markdownPath!;
      assertSafePath(mdPath);
      const content = await client.getMarkdown(mdPath);
      if (content) {
        await storage.write(`content/${mdPath}`, content);
      }
    });
  }

  // Download new/changed assets
  const assetDownloads: Array<{ path: string }> = [];
  for (const re of remoteEntities) {
    for (const asset of (re.data as unknown as EntityData).assets ?? []) {
      assetDownloads.push({ path: asset.storagePath });
    }
  }
  if (assetDownloads.length > 0) {
    log(`Downloading ${assetDownloads.length} assets...`);
    await runConcurrent(assetDownloads, 10, async ({ path }) => {
      assertSafePath(path);
      const content = await client.getFile(path);
      if (content) {
        await storage.write(`attachments/${path}`, Buffer.from(content));
      }
    });
  }

  // Delete files for removed entities
  for (const fileOp of plan.files.delete) {
    const prefix = fileOp.type === "asset" ? "attachments" : "content";
    try {
      await storage.delete(`${prefix}/${fileOp.path}`);
    } catch {
      // File may already be gone
    }
  }

  // Apply DB changes: insert new entities
  for (const entry of plan.entities.add) {
    const re = remoteByExtId.get(entry.externalId);
    if (!re) continue;
    const { folder, slug } = splitMarkdownPath(re.markdownPath);
    colDb
      .insert(entities)
      .values({
        externalId: re.externalId,
        entityType: re.entityType,
        title: re.title,
        data: re.data as unknown as EntityData,
        contentHash: re.hash,
        folder,
        slug,
      })
      .run();
  }

  // Apply DB changes: update existing entities
  for (const entry of plan.entities.update) {
    const re = remoteByExtId.get(entry.externalId);
    if (!re) continue;
    const { folder, slug } = splitMarkdownPath(re.markdownPath);
    colDb
      .update(entities)
      .set({
        entityType: re.entityType,
        title: re.title,
        data: re.data as unknown as EntityData,
        contentHash: re.hash,
        folder,
        slug,
        updatedAt: new Date().toISOString().replace("T", " ").replace("Z", ""),
      })
      .where(eq(entities.externalId, entry.externalId))
      .run();
  }

  // Collect numeric IDs for deleted entities before removing them from DB
  const deletedEntityIds: number[] = [];
  for (const extId of plan.entities.delete) {
    const [row] = colDb
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.externalId, extId))
      .all();
    if (row) deletedEntityIds.push(row.id);
    colDb.delete(entities).where(eq(entities.externalId, extId)).run();
  }

  // Rebuild search index for changed entities
  const indexer = new SearchIndexer(dbPath);
  for (const re of remoteEntities) {
    const [dbEntity] = colDb
      .select()
      .from(entities)
      .where(eq(entities.externalId, re.externalId))
      .all();
    if (!dbEntity) continue;

    let content = "";
    if (re.markdownPath) {
      try {
        content = await storage.read(`content/${re.markdownPath}`);
      } catch { /* ok */ }
    }
    const reData = re.data as Record<string, unknown> | undefined;
    const reAssets = reData?.assets as Array<{ text?: string }> | undefined;
    const attachmentText = (reAssets ?? [])
      .map((a) => a.text)
      .filter((t): t is string => Boolean(t && t.trim()))
      .join("\n");
    indexer.updateIndex({
      id: dbEntity.id,
      externalId: re.externalId,
      entityType: re.entityType,
      title: re.title,
      content,
      tags: (reData?.tags as string[] | undefined) ?? [],
      attachmentText,
    });
  }
  for (const entityId of deletedEntityIds) {
    indexer.removeIndex(entityId);
  }
  indexer.close();

  if (remoteManifestHash) meta.setRemoteManifestHash(remoteManifestHash);
  meta.close();

  const result: PullCollectionResult = {
    created: plan.entities.add.length,
    updated: plan.entities.update.length,
    deleted: plan.entities.delete.length,
  };

  log(
    `Synced: +${result.created} added, ~${result.updated} updated, -${result.deleted} deleted`,
  );

  return result;
}
