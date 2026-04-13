import { Command } from "commander";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  listCollections,
  getCollection,
  getCollectionDbPath,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
  entities,
} from "@frozenink/core";
import { sql } from "drizzle-orm";
import { createDefaultRegistry, gitHubTheme, obsidianTheme, gitTheme, mantisHubTheme } from "@frozenink/crawlers";

export const syncCommand = new Command("sync")
  .description("Sync collections")
  .argument("<collection>", 'Collection name or "*" for all collections')
  .option("--full", "Full re-sync (ignore cursors)")
  .option("--max <count>", "Maximum entities per type to sync (overrides collection config)", parseInt)
  .option("--max-issues <count>", "Maximum issues to sync (overrides collection config)", parseInt)
  .option("--max-prs <count>", "Maximum pull requests to sync (overrides collection config)", parseInt)
  .action(async (collection: string, opts: { full?: boolean; max?: number; maxIssues?: number; maxPrs?: number }) => {
    ensureInitialized();

    const home = getFrozenInkHome();
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
    themeEngine.register(mantisHubTheme);

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
      const collectionDir = join(home, "collections", col.name);

      // Full re-sync: nuke content/ and db/ directories so the sync starts clean
      if (opts.full) {
        const contentDir = join(collectionDir, "content");
        const dbDir = join(collectionDir, "db");
        if (existsSync(contentDir)) rmSync(contentDir, { recursive: true, force: true });
        if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true });
        console.log(`  Cleared all data for full re-sync`);
      }
      const storage = new LocalStorageBackend(collectionDir);

      const engine = new SyncEngine({
        crawler,
        dbPath,
        collectionName: col.name,
        themeEngine,
        storage,
        markdownBasePath: "content",
        assetConfig: col.assets as { extensions?: string[]; maxSize?: number } | undefined,
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
