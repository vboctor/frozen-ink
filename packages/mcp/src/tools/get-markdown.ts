import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getMasterDb, getCollectionDb, collections, entities } from "@veecontext/core";
import { eq } from "drizzle-orm";
import type { McpServerOptions } from "../server";

export function registerGetMarkdown(
  server: McpServer,
  options: McpServerOptions,
): void {
  server.registerTool(
    "entity_get_markdown",
    {
      title: "Get Entity Markdown",
      description:
        "Returns rendered markdown content for an entity by collection name and external ID",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        externalId: z.string().describe("External ID of the entity"),
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
      const [col] = db
        .select()
        .from(collections)
        .where(eq(collections.name, args.collection))
        .all();

      if (!col) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Collection "${args.collection}" not found`,
              }),
            },
          ],
        };
      }

      if (!existsSync(col.dbPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Collection database not found" }),
            },
          ],
        };
      }

      const colDb = getCollectionDb(col.dbPath);
      const [entity] = colDb
        .select()
        .from(entities)
        .where(eq(entities.externalId, args.externalId))
        .all();

      if (!entity) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Entity "${args.externalId}" not found in "${args.collection}"`,
              }),
            },
          ],
        };
      }

      if (!entity.markdownPath) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Entity "${args.externalId}" has no rendered markdown`,
              }),
            },
          ],
        };
      }

      const collectionDir = join(options.veecontextHome, "collections", args.collection);
      const markdownPath = join(collectionDir, entity.markdownPath);

      if (!existsSync(markdownPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Markdown file not found: ${entity.markdownPath}`,
              }),
            },
          ],
        };
      }

      const markdown = readFileSync(markdownPath, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              collection: args.collection,
              externalId: entity.externalId,
              title: entity.title,
              markdownPath: entity.markdownPath,
              markdown,
              updatedAt: entity.updatedAt,
            }),
          },
        ],
      };
    },
  );
}
