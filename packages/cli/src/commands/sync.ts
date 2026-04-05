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
  syncState,
  entities,
  entityTags,
  attachments,
  entityLinks,
  entityRelations,
} from "@veecontext/core";
import { createDefaultRegistry, gitHubTheme, obsidianTheme, gitTheme } from "@veecontext/crawlers";

export const syncCommand = new Command("sync")
  .description("Sync collections")
  .option("--collection <name>", "Sync a specific collection")
  .option("--full", "Full re-sync (ignore cursors)")
  .action(async (opts: { collection?: string; full?: boolean }) => {
    const home = getVeeContextHome();
    const masterDbPath = join(home, "master.db");

    if (!existsSync(masterDbPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const db = getMasterDb(masterDbPath);
    let collectionRows = db.select().from(collections).all();

    if (opts.collection) {
      collectionRows = collectionRows.filter(
        (c) => c.name === opts.collection,
      );
      if (collectionRows.length === 0) {
        console.error(`Collection "${opts.collection}" not found`);
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
      await crawler.initialize(
        col.config as Record<string, unknown>,
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
      });

      try {
        await engine.run();
        console.log(`  Sync completed for "${col.name}"`);
      } catch (err) {
        console.error(`  Sync failed for "${col.name}": ${err}`);
      }

      await crawler.dispose();
    }
  });
