import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  getCollectionDb,
  collections,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
  SearchIndexer,
  syncState,
  entities,
  entityTags,
  attachments,
  entityLinks,
  entityRelations,
} from "@veecontext/core";
import { sql } from "drizzle-orm";
import { createDefaultRegistry, gitHubTheme, obsidianTheme, gitTheme, mantisBTTheme } from "@veecontext/crawlers";

export const syncCommand = new Command("sync")
  .description("Sync collections")
  .argument("<collection>", 'Collection name or "*" for all collections')
  .option("--full", "Full re-sync (ignore cursors)")
  .option("--max <count>", "Maximum entities to sync (overrides collection config)", parseInt)
  .action(async (collection: string, opts: { full?: boolean; max?: number }) => {
    const home = getVeeContextHome();
    const masterDbPath = join(home, "master.db");

    if (!existsSync(masterDbPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const db = getMasterDb(masterDbPath);
    let collectionRows = db.select().from(collections).all();

    if (collection !== "*") {
      collectionRows = collectionRows.filter(
        (c) => c.name === collection,
      );
      if (collectionRows.length === 0) {
        console.error(`Collection "${collection}" not found`);
        process.exit(1);
      }
    }

    // Filter to enabled collections
    collectionRows = collectionRows.filter((c) => c.enabled);

    if (collectionRows.length === 0) {
      console.log("No enabled collections to sync");
      return;
    }

    const registry = createDefaultRegistry();
    const themeEngine = new ThemeEngine();
    themeEngine.register(gitHubTheme);
    themeEngine.register(obsidianTheme);
    themeEngine.register(gitTheme);
    themeEngine.register(mantisBTTheme);

    for (const col of collectionRows) {
      console.log(`Syncing "${col.name}" (${col.crawlerType})...`);

      const factory = registry.get(col.crawlerType);
      if (!factory) {
        console.error(
          `  No crawler for type: ${col.crawlerType}, skipping`,
        );
        continue;
      }

      const crawler = factory();
      const config = { ...(col.config as Record<string, unknown>) };
      if (opts.max !== undefined) {
        config.maxEntities = opts.max;
      }
      await crawler.initialize(
        config,
        col.credentials as Record<string, unknown>,
      );

      // Full re-sync: wipe all collection data so the sync starts clean
      if (opts.full) {
        const colDb = getCollectionDb(col.dbPath);
        colDb.delete(entityLinks).run();
        colDb.delete(entityRelations).run();
        colDb.delete(attachments).run();
        colDb.delete(entityTags).run();
        colDb.delete(entities).run();
        colDb.delete(syncState).run();
        const indexer = new SearchIndexer(col.dbPath);
        indexer.clearIndex();
        indexer.close();
        console.log(`  Cleared all data for full re-sync`);
      }

      const collectionDir = join(home, "collections", col.name);
      const storage = new LocalStorageBackend(collectionDir);

      const engine = new SyncEngine({
        crawler,
        dbPath: col.dbPath,
        collectionName: col.name,
        themeEngine,
        storage,
        markdownBasePath: "markdown",
        onBatchFetched: ({ externalIds }) => {
          if (externalIds.length === 0) return;
          const ids = externalIds.map((externalId) => {
            if (externalId.startsWith("issue:")) {
              return externalId.slice("issue:".length);
            }
            return externalId;
          });
          console.log(`  page ids: ${ids.join(",")}`);
        },
      });

      try {
        const stats = await engine.run();
        const colDb = getCollectionDb(col.dbPath);
        const [{ total }] = colDb
          .select({ total: sql<number>`count(*)` })
          .from(entities)
          .all();
        console.log(
          `  Sync completed: ${stats.created} added, ${stats.updated} updated, ${stats.deleted} deleted (${total} total entities)`,
        );
      } catch (err) {
        console.error(`  Sync failed for "${col.name}": ${err}`);
      }

      await crawler.dispose();
    }
  });
