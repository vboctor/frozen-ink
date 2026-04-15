import { Command } from "commander";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  addCollection,
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

export const cloneCommand = new Command("clone")
  .description("Clone a published collection from a remote Frozen Ink site")
  .argument("<url>", "URL of the published site (e.g. https://my-fink.workers.dev)")
  .option("--name <name>", "Local collection name (defaults to remote collection name)")
  .option("--password <password>", "Password for protected sites")
  .option("--dry-run", "Show sync plan without making changes")
  .action(async (url: string, opts: { name?: string; password?: string; dryRun?: boolean }) => {
    ensureInitialized();
    const home = getFrozenInkHome();

    const client = new RemoteClient(url, opts.password);

    console.log("Fetching manifest...");
    const { manifest, entries } = await client.getManifest();

    const remoteName = manifest.collection?.name ?? client.getCollectionName() ?? "remote";
    const localName = opts.name ?? remoteName;

    console.log(`Collection: ${manifest.collection?.title ?? remoteName} (${entries.length} entities)`);

    // Clone is like a pull from empty — all entities are "add"
    const plan = computeSyncPlan([], entries);

    if (opts.dryRun) {
      printSyncPlan(plan);
      return;
    }

    // Fail if collection already exists
    const existingCol = getCollection(localName);
    if (existingCol !== null) {
      console.error(`Collection "${localName}" already exists. Use 'fink pull' to update it.`);
      process.exit(1);
    }

    // Register the collection
    addCollection(localName, {
      crawler: "remote",
      title: manifest.collection?.title,
      config: { sourceUrl: url },
      credentials: opts.password ? { password: opts.password } : {},
    });

    const dbPath = getCollectionDbPath(localName);
    const colDb = getCollectionDb(dbPath);
    const collectionDir = join(home, "collections", localName);
    const storage = new LocalStorageBackend(collectionDir);

    // Batch-fetch all entity data
    const allExternalIds = entries.map((e) => e.externalId);
    console.log(`Fetching ${allExternalIds.length} entities...`);
    const remoteEntities = await client.getEntitiesBulk(allExternalIds);
    const remoteByExtId = new Map<string, RemoteEntityData>();
    for (const re of remoteEntities) {
      remoteByExtId.set(re.externalId, re);
    }

    // Insert entities into DB
    for (const re of remoteEntities) {
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

    // Download markdown files
    const mdDownloads = remoteEntities.filter((e) => e.markdownPath);
    console.log(`Downloading ${mdDownloads.length} markdown files...`);
    let downloaded = 0;
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
      downloaded++;
      if (downloaded % 50 === 0) {
        console.log(`  ${downloaded}/${mdDownloads.length} downloaded...`);
      }
    });

    // Download asset files
    const assetDownloads: Array<{ path: string; entity: RemoteEntityData }> = [];
    for (const re of remoteEntities) {
      for (const asset of (re.data as unknown as EntityData).assets ?? []) {
        assetDownloads.push({ path: asset.storagePath, entity: re });
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

    // Build search index
    const indexer = new SearchIndexer(dbPath);
    for (const re of remoteEntities) {
      if (!re.markdownPath) continue;
      let content = "";
      try {
        content = await storage.read(`content/${re.markdownPath}`);
      } catch { /* file may not exist */ }
      const [dbEntity] = colDb
        .select()
        .from(entities)
        .where(eq(entities.externalId, re.externalId))
        .all();
      if (dbEntity) {
        indexer.updateIndex({
          id: dbEntity.id,
          externalId: re.externalId,
          entityType: re.entityType,
          title: re.title,
          content,
          tags: re.tags ?? [],
        });
      }
    }
    indexer.close();

    console.log(`\nCloned "${localName}": ${remoteEntities.length} entities`);
  });
