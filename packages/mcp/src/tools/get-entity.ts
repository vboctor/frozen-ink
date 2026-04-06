import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  getMasterDb,
  collections,
  getCollectionDb,
  entities,
  entityTags,
} from "@veecontext/core";
import { eq } from "drizzle-orm";
import type { McpServerOptions } from "../server";

export function registerGetEntity(
  server: McpServer,
  options: McpServerOptions,
): void {
  server.registerTool(
    "entity_get_data",
    {
      title: "Get Entity",
      description:
        "Returns full entity data and rendered markdown by collection name and external ID",
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

      const dbPath = col.dbPath;
      if (!existsSync(dbPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Collection database not found" }),
            },
          ],
        };
      }

      const colDb = getCollectionDb(dbPath);
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

      const tags = colDb
        .select()
        .from(entityTags)
        .where(eq(entityTags.entityId, entity.id))
        .all()
        .map((t) => t.tag);

      let markdown: string | null = null;
      if (entity.markdownPath) {
        const collectionDir = join(
          options.veecontextHome,
          "collections",
          args.collection,
        );
        const mdPath = join(collectionDir, entity.markdownPath);
        if (existsSync(mdPath)) {
          markdown = readFileSync(mdPath, "utf-8");
        }
      }

      const result = {
        id: entity.id,
        externalId: entity.externalId,
        entityType: entity.entityType,
        title: entity.title,
        data: entity.data,
        url: entity.url,
        tags,
        markdown,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
