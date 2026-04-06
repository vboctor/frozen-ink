import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "fs";
import { join } from "path";
import {
  getMasterDb,
  collections,
  SearchIndexer,
  type SearchResult,
} from "@veecontext/core";
import { eq } from "drizzle-orm";
import type { McpServerOptions } from "../server";

export function registerSearch(
  server: McpServer,
  options: McpServerOptions,
): void {
  server.registerTool(
    "entity_search",
    {
      title: "Search Entities",
      description:
        "Performs FTS5 full-text search across synced entities with optional collection, type, and tag filters",
      inputSchema: {
        query: z.string().describe("Full-text search query"),
        collection: z
          .string()
          .optional()
          .describe("Filter to a specific collection"),
        entityType: z
          .string()
          .optional()
          .describe("Filter by entity type (e.g., issue, pull_request)"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(20)
          .describe("Maximum number of results"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const masterDbPath = join(options.veecontextHome, "master.db");
      if (!existsSync(masterDbPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "VeeContext not initialized" }),
            },
          ],
        };
      }

      const db = getMasterDb(masterDbPath);
      let collectionRows: Array<{ name: string; dbPath: string }>;

      if (args.collection) {
        const [col] = db
          .select()
          .from(collections)
          .where(eq(collections.name, args.collection))
          .all();
        collectionRows = col ? [col] : [];
      } else {
        collectionRows = db.select().from(collections).all();
      }

      const allResults: Array<SearchResult & { collection: string }> = [];

      for (const col of collectionRows) {
        const dbPath = col.dbPath;
        if (!existsSync(dbPath)) continue;

        const indexer = new SearchIndexer(dbPath);
        try {
          const results = indexer.search(args.query, {
            entityType: args.entityType,
          });
          for (const r of results) {
            allResults.push({ ...r, collection: col.name });
          }
        } finally {
          indexer.close();
        }
      }

      allResults.sort((a, b) => a.rank - b.rank);
      const limited = allResults.slice(0, args.limit);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(limited) }],
      };
    },
  );
}
