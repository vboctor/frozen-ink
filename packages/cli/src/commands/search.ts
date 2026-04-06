import { Command } from "commander";
import { existsSync } from "fs";
import { eq } from "drizzle-orm";
import {
  contextExists,
  getMasterDb,
  getMasterDbPath,
  collections,
  SearchIndexer,
  type SearchResult,
} from "@veecontext/core";

export const searchCommand = new Command("search")
  .description("Search across synced content")
  .argument("<query>", "Search query")
  .option("--collection <name>", "Search within a specific collection")
  .option("--type <type>", "Filter by entity type (e.g., issue, pull_request)")
  .option("--limit <n>", "Maximum results", "20")
  .option("--json", "Output results as JSON")
  .action(
    (
      query: string,
      opts: {
        collection?: string;
        type?: string;
        limit: string;
        json?: boolean;
      },
    ) => {
      if (!contextExists()) {
        console.error("VeeContext not initialized. Run: vctx init");
        process.exit(1);
      }

      const masterDb = getMasterDb(getMasterDbPath());

      let collectionRows: Array<{ name: string; dbPath: string }>;
      if (opts.collection) {
        const [col] = masterDb
          .select()
          .from(collections)
          .where(eq(collections.name, opts.collection))
          .all();
        if (!col) {
          console.error(`Collection "${opts.collection}" not found`);
          process.exit(1);
        }
        collectionRows = [col];
      } else {
        collectionRows = masterDb.select().from(collections).all();
      }

      const limit = parseInt(opts.limit, 10);
      const allResults: Array<SearchResult & { collection: string }> = [];

      for (const col of collectionRows) {
        const dbPath = col.dbPath;
        if (!existsSync(dbPath)) continue;

        const indexer = new SearchIndexer(dbPath);
        try {
          const results = indexer.search(query, {
            entityType: opts.type,
            collectionName: col.name,
          });

          for (const r of results) {
            allResults.push({ ...r, collection: col.name });
          }
        } finally {
          indexer.close();
        }
      }

      // Sort by rank (lower is better in FTS5) and limit
      allResults.sort((a, b) => a.rank - b.rank);
      const limited = allResults.slice(0, limit);

      if (opts.json) {
        console.log(JSON.stringify(limited, null, 2));
        return;
      }

      if (limited.length === 0) {
        console.log("No results found");
        return;
      }

      for (const r of limited) {
        console.log(
          `[${r.collection}] ${r.entityType}: ${r.title} (${r.externalId})`,
        );
      }
      console.log(`\n${limited.length} result(s)`);
    },
  );
