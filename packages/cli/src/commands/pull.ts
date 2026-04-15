import { Command } from "commander";
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

export const pullCommand = new Command("pull")
  .description("Pull updates from a remote published site into a cloned collection")
  .argument("<collection>", "Collection name (must have crawler: remote)")
  .option("--dry-run", "Show sync plan without making changes")
  .action(async (collection: string, opts: { dryRun?: boolean }) => {
    ensureInitialized();
    const home = getFrozenInkHome();

    const col = getCollection(collection);
    if (!col) {
      console.error(`Collection "${collection}" not found`);
      process.exit(1);
    }

    if (col.crawler !== "remote") {
      console.error(`Collection "${collection}" is not a remote clone (crawler: ${col.crawler})`);
      process.exit(1);
    }

    const sourceUrl = (col.config as any)?.sourceUrl;
    if (!sourceUrl) {
      console.error(`Collection "${collection}" has no sourceUrl in config`);
      process.exit(1);
    }

    const password = (col.credentials as any)?.password;
    const client = new RemoteClient(sourceUrl, password);

    const dbPath = getCollectionDbPath(collection);
    if (!existsSync(dbPath)) {
      console.error(`Collection "${collection}" database not found. Run 'fink clone' first.`);
      process.exit(1);
    }

    const colDb = getCollectionDb(dbPath);
    const collectionDir = join(home, "collections", collection);
    const storage = new LocalStorageBackend(collectionDir);

    // Fetch remote manifest
    console.log("Fetching manifest...");
    const { manifest, entries } = await client.getManifest();

    // Build local entity list
    const allLocal = colDb.select().from(entities).all();
    const localEntities: LocalEntity[] = allLocal.map((e: any) => ({
      externalId: e.externalId,
      entityType: e.entityType,
      title: e.title,
      data: e.data as unknown as EntityData,
      contentHash: e.contentHash,
      markdownPath: e.markdownPath,
      url: e.url,
      tags: (e.tags as string[] | null) ?? null,
    }));

    // Compute sync plan
    const plan = computeSyncPlan(localEntities, entries);

    if (isSyncPlanEmpty(plan)) {
      console.log("Already up to date.");
      return;
    }

    printSyncPlan(plan);

    if (opts.dryRun) {
      return;
    }

    // Fetch full data for added and updated entities
    const fetchIds = [
      ...plan.entities.add.map((e) => e.externalId),
      ...plan.entities.update.map((e) => e.externalId),
    ];

    let remoteEntities: RemoteEntityData[] = [];
    if (fetchIds.length > 0) {
      console.log(`Fetching ${fetchIds.length} entities...`);
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
      console.log(`Downloading ${mdDownloads.length} files...`);
      await runConcurrent(mdDownloads, 10, async (re) => {
        assertSafePath(re.markdownPath!);
        const content = await client.getMarkdown(re.markdownPath!);
        if (content) {
          await storage.write(`content/${re.markdownPath}`, content);
          // Set file mtime from stored metadata
          const mtime = (re.data as unknown as EntityData).markdown_mtime;
          if (mtime) {
            await storage.utimes?.(`content/${re.markdownPath}`, mtime);
          }
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
      console.log(`Downloading ${assetDownloads.length} assets...`);
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
      colDb
        .insert(entities)
        .values({
          externalId: re.externalId,
          entityType: re.entityType,
          title: re.title,
          data: re.data as unknown as EntityData,
          contentHash: re.hash,
          markdownPath: re.markdownPath,
          url: re.url,
          tags: re.tags,
        })
        .run();
    }

    // Apply DB changes: update existing entities
    for (const entry of plan.entities.update) {
      const re = remoteByExtId.get(entry.externalId);
      if (!re) continue;
      colDb
        .update(entities)
        .set({
          entityType: re.entityType,
          title: re.title,
          data: re.data as unknown as EntityData,
          contentHash: re.hash,
          markdownPath: re.markdownPath,
          url: re.url,
          tags: re.tags,
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
      indexer.updateIndex({
        id: dbEntity.id,
        externalId: re.externalId,
        entityType: re.entityType,
        title: re.title,
        content,
        tags: re.tags ?? [],
      });
    }
    for (const entityId of deletedEntityIds) {
      indexer.removeIndex(entityId);
    }
    indexer.close();

    console.log(
      `\nPulled: +${plan.entities.add.length} added, ~${plan.entities.update.length} updated, -${plan.entities.delete.length} deleted`,
    );
  });
