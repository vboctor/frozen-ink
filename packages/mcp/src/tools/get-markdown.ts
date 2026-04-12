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

async function handleGetMarkdown(
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

    if (!entity.markdownPath) {
      return textErr(`Entity "${externalId}" has no rendered markdown`);
    }

    const collectionDir = join(options.frozeninkHome, "collections", colName);
    const markdownPath = join(collectionDir, entity.markdownPath);

    if (!existsSync(markdownPath)) {
      return textErr(`Markdown file not found: ${entity.markdownPath}`);
    }

    const markdown = readFileSync(markdownPath, "utf-8");

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            collection: colName,
            externalId: entity.externalId,
            title: entity.title,
            markdownPath: entity.markdownPath,
            markdown,
            updatedAt: entity.updatedAt,
          }),
        },
      ],
    };
  }

  const scope = collectionName ? `"${collectionName}"` : "any collection";
  return textErr(`Entity "${externalId}" not found in ${scope}`);
}

export function registerGetMarkdown(
  server: McpServer,
  options: McpServerOptions,
): void {
  const { singleCollectionName } = options;

  if (singleCollectionName) {
    server.registerTool(
      "entity_get_markdown",
      {
        title: "Get Entity Markdown",
        description:
          "Returns rendered markdown content for an entity by external ID",
        inputSchema: {
          externalId: z.string().describe("External ID of the entity"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => handleGetMarkdown(singleCollectionName, args.externalId, options),
    );
  } else {
    server.registerTool(
      "entity_get_markdown",
      {
        title: "Get Entity Markdown",
        description:
          "Returns rendered markdown content for an entity by external ID. When collection is omitted all allowed collections are searched.",
        inputSchema: {
          externalId: z.string().describe("External ID of the entity"),
          collection: z
            .string()
            .optional()
            .describe("Collection to search in. Omit to search all allowed collections."),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => handleGetMarkdown(args.collection, args.externalId, options),
    );
  }
}
