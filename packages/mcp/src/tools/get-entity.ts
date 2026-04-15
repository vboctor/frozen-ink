import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  contextExists,
  listCollections,
  getCollection,
  getCollectionDb,
  getCollectionDbPath,
  entities,
} from "@frozenink/core";
import { eq } from "drizzle-orm";
import type { McpServerOptions } from "../server";
import {
  buildCollectionDeniedError,
  filterAllowedCollections,
  isCollectionAllowed,
} from "../collection-scope";

function textErr(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  };
}

async function handleGetEntity(
  collectionName: string | undefined,
  externalId: string,
  options: McpServerOptions,
) {
  if (!contextExists()) {
    return textErr("Frozen Ink not initialized");
  }

  // Resolve which collections to search.
  type ColRow = { name: string; dbPath: string };
  let colRows: ColRow[];

  if (collectionName) {
    if (!isCollectionAllowed(options, collectionName)) {
      return textErr(buildCollectionDeniedError(collectionName));
    }
    const col = getCollection(collectionName);
    if (!col) return textErr(`Collection "${collectionName}" not found`);
    const dbPath = getCollectionDbPath(collectionName);
    if (!existsSync(dbPath)) return textErr("Collection database not found");
    colRows = [{ name: collectionName, dbPath }];
  } else {
    colRows = filterAllowedCollections(options, listCollections())
      .map((col) => ({ name: col.name, dbPath: getCollectionDbPath(col.name) }))
      .filter((row) => existsSync(row.dbPath));
  }

  for (const { name: colName, dbPath } of colRows) {
    const colDb = getCollectionDb(dbPath);
    const [entity] = colDb
      .select()
      .from(entities)
      .where(eq(entities.externalId, externalId))
      .all();

    if (!entity) continue;

    const entityTagRows: string[] = (entity as any).tags ?? [];

    let markdown: string | null = null;
    if (entity.markdownPath) {
      const mdPath = join(options.frozeninkHome, "collections", colName, "content", entity.markdownPath);
      if (existsSync(mdPath)) {
        markdown = readFileSync(mdPath, "utf-8");
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            id: entity.externalId,
            collection: colName,
            entityType: entity.entityType,
            title: entity.title,
            data: entity.data,
            url: entity.url,
            tags: entityTagRows,
            markdown,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
          }),
        },
      ],
    };
  }

  const scope = collectionName ? `"${collectionName}"` : "any collection";
  return textErr(`Entity "${externalId}" not found in ${scope}`);
}

export function registerGetEntity(
  server: McpServer,
  options: McpServerOptions,
): void {
  const { singleCollectionName } = options;

  if (singleCollectionName) {
    server.registerTool(
      "entity_get_data",
      {
        title: "Get Entity",
        description:
          "Retrieve the full content and structured metadata for an item by its ID. Use entity_search first to find IDs, then call this to read the complete record including title, URL, tags, dates, and all source data.",
        inputSchema: {
          id: z.string().describe("The item ID, as returned by entity_search"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => handleGetEntity(singleCollectionName, args.id, options),
    );
  } else {
    server.registerTool(
      "entity_get_data",
      {
        title: "Get Entity",
        description:
          "Retrieve the full content and structured metadata for an item by its ID. Use entity_search first to find IDs, then call this to read the complete record. Optionally specify a collection to narrow the lookup.",
        inputSchema: {
          id: z.string().describe("The item ID, as returned by entity_search"),
          collection: z
            .string()
            .optional()
            .describe("Collection to look in. Omit to search all collections."),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => handleGetEntity(args.collection, args.id, options),
    );
  }
}
