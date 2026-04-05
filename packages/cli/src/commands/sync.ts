import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  collections,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
  syncState,
} from "@veecontext/core";
import { eq } from "drizzle-orm";
import { createDefaultRegistry, gitHubTheme } from "@veecontext/connectors";

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

    for (const col of collectionRows) {
      console.log(`Syncing "${col.name}" (${col.connectorType})...`);

      const factory = registry.get(col.connectorType);
      if (!factory) {
        console.error(
          `  No connector for type: ${col.connectorType}, skipping`,
        );
        continue;
      }

      const connector = factory();
      await connector.initialize(
        col.config as Record<string, unknown>,
        col.credentials as Record<string, unknown>,
      );

      // Clear cursor for full re-sync
      if (opts.full) {
        const { getCollectionDb } = await import("@veecontext/core");
        const colDb = getCollectionDb(col.dbPath);
        colDb.delete(syncState).where(eq(syncState.connectorType, col.connectorType)).run();
        console.log("  Cleared sync cursor for full re-sync");
      }

      const collectionDir = join(home, "collections", col.name);
      const storage = new LocalStorageBackend(collectionDir);

      const engine = new SyncEngine({
        connector,
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

      await connector.dispose();
    }
  });
