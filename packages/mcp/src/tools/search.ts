import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "fs";
import { eq } from "drizzle-orm";
import {
  contextExists,
  listCollections,
  getCollection,
  getCollectionDb,
  getCollectionDbPath,
  SearchIndexer,
  entities,
  type SearchResult,
} from "@frozenink/core";
import type { McpServerOptions } from "../server";
import {
  buildCollectionDeniedError,
  filterAllowedCollections,
  isCollectionAllowed,
} from "../collection-scope";

async function runSearch(
  options: McpServerOptions,
  query: string,
  collectionFilter: string | undefined,
  entityType: string | undefined,
  limit: number,
) {
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

  if (collectionFilter && !isCollectionAllowed(options, collectionFilter)) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: buildCollectionDeniedError(collectionFilter),
          }),
        },
      ],
    };
  }

  const collectionRows = collectionFilter
    ? (() => {
        const col = getCollection(collectionFilter);
        return col ? [col] : [];
      })()
    : filterAllowedCollections(options, listCollections());

  const allResults: Array<SearchResult & { collection: string; filename: string | null }> = [];

  for (const col of collectionRows) {
    const dbPath = getCollectionDbPath(col.name);
    if (!existsSync(dbPath)) continue;

    const colDb = getCollectionDb(dbPath);
    const indexer = new SearchIndexer(dbPath);
    try {
      const results = indexer.search(query, { entityType });
      for (const r of results) {
        const [entity] = colDb
          .select({ markdownPath: entities.markdownPath })
          .from(entities)
          .where(eq(entities.id, r.entityId))
          .all();
        const rawPath = entity?.markdownPath ?? null;
        const filename = rawPath ? rawPath.replace(/^markdown\//, "") : null;
        allResults.push({ ...r, collection: col.name, filename });
      }
    } finally {
      indexer.close();
    }
  }

  allResults.sort((a, b) => a.rank - b.rank);
  const limited = allResults.slice(0, limit).map(({ externalId, entityId, rank, ...rest }) => ({
    id: externalId,
    ...rest,
  }));

  return {
    content: [{ type: "text" as const, text: JSON.stringify(limited) }],
  };
}

export function registerSearch(
  server: McpServer,
  options: McpServerOptions,
): void {
  const { singleCollectionName } = options;

  if (singleCollectionName) {
    server.registerTool(
      "entity_search",
      {
        title: "Search Entities",
        description: `Search this collection for notes, issues, commits, or documents matching a keyword or phrase. Use this to answer questions about the user's knowledge base. Results include an 'id' you can pass to entity_get_markdown, a 'snippet' with the matching excerpt, and a 'filename' with the document path.`,
        inputSchema: {
          query: z.string().describe("Keyword or phrase to search for"),
          entityType: z
            .string()
            .optional()
            .describe("Filter by entity type (e.g., issue, pull_request, note, commit)"),
          limit: z
            .number()
            .int()
            .positive()
            .optional()
            .default(20)
            .describe("Maximum number of results to return"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => runSearch(options, args.query, singleCollectionName, args.entityType, args.limit),
    );
  } else {
    server.registerTool(
      "entity_search",
      {
        title: "Search Entities",
        description:
          "Search across all Frozen Ink collections for notes, issues, commits, or documents matching a keyword or phrase. Use this to answer questions using the user's knowledge base. Optionally filter by collection or entity type. Results include an 'id' you can pass to entity_get_markdown, a 'snippet' with the matching excerpt, and a 'filename' with the document path.",
        inputSchema: {
          query: z.string().describe("Keyword or phrase to search for"),
          collection: z
            .string()
            .optional()
            .describe("Limit search to a specific collection name"),
          entityType: z
            .string()
            .optional()
            .describe("Filter by entity type (e.g., issue, pull_request, note, commit)"),
          limit: z
            .number()
            .int()
            .positive()
            .optional()
            .default(20)
            .describe("Maximum number of results to return"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => runSearch(options, args.query, args.collection, args.entityType, args.limit),
    );
  }
}
