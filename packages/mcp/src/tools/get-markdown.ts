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
  entityMarkdownPath,
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

    const storedMarkdownPath = entityMarkdownPath(entity.folder, entity.slug);

    if (!storedMarkdownPath) {
      return textErr(`Entity "${externalId}" has no rendered markdown`);
    }

    const collectionDir = join(options.frozeninkHome, "collections", colName);
    const markdownPath = join(collectionDir, "content", storedMarkdownPath);

    if (!existsSync(markdownPath)) {
      return textErr(`Markdown file not found: ${storedMarkdownPath}`);
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
            markdownPath: storedMarkdownPath,
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
          "Get the full readable markdown content of a note, issue, commit, or document by its ID. Use this when you need to read or quote the complete text. Prefer this over entity_get_data when the goal is to read content rather than inspect metadata.",
        inputSchema: {
          id: z.string().describe("The item ID, as returned by entity_search"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => handleGetMarkdown(singleCollectionName, args.id, options),
    );
  } else {
    server.registerTool(
      "entity_get_markdown",
      {
        title: "Get Entity Markdown",
        description:
          "Get the full readable markdown content of a note, issue, commit, or document by its ID. Use this when you need to read or quote the complete text. Optionally specify a collection. Prefer this over entity_get_data when the goal is to read content rather than inspect metadata.",
        inputSchema: {
          id: z.string().describe("The item ID, as returned by entity_search"),
          collection: z
            .string()
            .optional()
            .describe("Collection to look in. Omit to search all collections."),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => handleGetMarkdown(args.collection, args.id, options),
    );
  }
}
