import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "fs";
import {
  contextExists,
  listCollections,
  getCollection,
  getCollectionDbPath,
  SearchIndexer,
  type SearchResult,
} from "@frozenink/core";
import type { McpServerOptions } from "../server";
import {
  buildCollectionDeniedError,
  filterAllowedCollections,
  isCollectionAllowed,
} from "../collection-scope";

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
      if (!contextExists()) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Frozen Ink not initialized" }),
            },
          ],
        };
      }

      const collectionRows = args.collection
        ? (() => {
            if (!isCollectionAllowed(options, args.collection)) {
              return [];
            }
            const col = getCollection(args.collection);
            return col ? [col] : [];
          })()
        : filterAllowedCollections(options, listCollections());

      if (args.collection && !isCollectionAllowed(options, args.collection)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: buildCollectionDeniedError(args.collection),
              }),
            },
          ],
        };
      }

      const allResults: Array<SearchResult & { collection: string }> = [];

      for (const col of collectionRows) {
        const dbPath = getCollectionDbPath(col.name);
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
