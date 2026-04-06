import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getCollectionDb,
  contextExists,
  listCollections,
  getCollection,
  getCollectionDbPath,
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
  .option("--max <count>", "Maximum entities per type to sync (overrides collection config)", parseInt)
  .option("--max-issues <count>", "Maximum issues to sync (overrides collection config)", parseInt)
  .option("--max-prs <count>", "Maximum pull requests to sync (overrides collection config)", parseInt)
  .action(async (collection: string, opts: { full?: boolean; max?: number; maxIssues?: number; maxPrs?: number }) => {
    if (!contextExists()) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const home = getVeeContextHome();
    let collectionRows = collection === "*"
      ? listCollections()
      : (() => {
          const col = getCollection(collection);
          if (!col) {
            console.error(`Collection "${collection}" not found`);
            process.exit(1);
          }
          return [col];
        })();

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
      console.log(`Syncing "${col.name}" (${col.crawler})...`);

      const factory = registry.get(col.crawler);
      if (!factory) {
        console.error(
          `  No crawler for type: ${col.crawler}, skipping`,
        );
        continue;
      }

      const crawler = factory();
      const config = { ...(col.config as Record<string, unknown>) };
      if (opts.max !== undefined) {
        // --max sets both per-type limits (e.g. --max 20 = at most 20 issues + 20 PRs)
        config.maxIssues = opts.max;
        config.maxPullRequests = opts.max;
      }
      if (opts.maxIssues !== undefined) {
        config.maxIssues = opts.maxIssues;
      }
      if (opts.maxPrs !== undefined) {
        config.maxPullRequests = opts.maxPrs;
      }
      await crawler.initialize(
        config,
        col.credentials as Record<string, unknown>,
      );

      const dbPath = getCollectionDbPath(col.name);

      // Full re-sync: wipe all collection data so the sync starts clean
      if (opts.full) {
        const colDb = getCollectionDb(dbPath);
        colDb.delete(entityLinks).run();
        colDb.delete(entityRelations).run();
        colDb.delete(attachments).run();
        colDb.delete(entityTags).run();
        colDb.delete(entities).run();
        colDb.delete(syncState).run();
        const indexer = new SearchIndexer(dbPath);
        indexer.clearIndex();
        indexer.close();
        console.log(`  Cleared all data for full re-sync`);
      }

      const collectionDir = join(home, "collections", col.name);
      const storage = new LocalStorageBackend(collectionDir);

      const engine = new SyncEngine({
        crawler,
        dbPath,
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
        const colDb = getCollectionDb(dbPath);
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
