import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  contextExists,
  getCollection,
  getCollectionDb,
  getCollectionDbPath,
  entities,
  entityTags,
  tags,
} from "@frozenink/core";
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

      const col = getCollection(args.collection);
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

      const dbPath = getCollectionDbPath(args.collection);
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

      const entityTagRows = colDb
        .select({ name: tags.name })
        .from(entityTags)
        .innerJoin(tags, eq(entityTags.tagId, tags.id))
        .where(eq(entityTags.entityId, entity.id))
        .all()
        .map((t: any) => t.name);

      let markdown: string | null = null;
      if (entity.markdownPath) {
        const collectionDir = join(
          options.frozeninkHome,
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
        tags: entityTagRows,
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
