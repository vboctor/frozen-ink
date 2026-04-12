import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import {
  buildCollectionDeniedError,
  isCollectionAllowed,
} from "../collection-scope";

export function registerEntityResources(
  server: McpServer,
  options: McpServerOptions,
): void {
  // Template resource: entity by collection and externalId
  const entityTemplate = new ResourceTemplate(
    "frozenink://entities/{collection}/{externalId}",
    {
      list: undefined,
    },
  );

  server.registerResource(
    "entity",
    entityTemplate,
    {
      description:
        "Full entity data by collection name and external ID",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const collectionName = variables.collection as string;
      const externalId = variables.externalId as string;

      if (!contextExists()) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: "Frozen Ink not initialized" }),
            },
          ],
        };
      }

      if (!isCollectionAllowed(options, collectionName)) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({
                error: buildCollectionDeniedError(collectionName),
              }),
            },
          ],
        };
      }

      const col = getCollection(collectionName);
      const dbPath = col ? getCollectionDbPath(collectionName) : null;

      if (!col || !dbPath || !existsSync(dbPath)) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({
                error: `Collection "${collectionName}" not found`,
              }),
            },
          ],
        };
      }

      const colDb = getCollectionDb(dbPath);
      const [entity] = colDb
        .select()
        .from(entities)
        .where(eq(entities.externalId, externalId))
        .all();

      if (!entity) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({
                error: `Entity "${externalId}" not found`,
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

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify({
              id: entity.id,
              externalId: entity.externalId,
              entityType: entity.entityType,
              title: entity.title,
              data: entity.data,
              url: entity.url,
              tags: entityTagRows,
              createdAt: entity.createdAt,
              updatedAt: entity.updatedAt,
            }),
          },
        ],
      };
    },
  );

  // Template resource: markdown by collection and path
  const markdownTemplate = new ResourceTemplate(
    "frozenink://markdown/{collection}/{+path}",
    {
      list: undefined,
    },
  );

  server.registerResource(
    "markdown",
    markdownTemplate,
    {
      description: "Rendered markdown file for an entity",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const collectionName = variables.collection as string;
      const path = variables.path as string;

      if (!contextExists()) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: "Frozen Ink not initialized",
            },
          ],
        };
      }

      if (!isCollectionAllowed(options, collectionName)) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: buildCollectionDeniedError(collectionName),
            },
          ],
        };
      }

      const col = getCollection(collectionName);
      if (!col) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: `Collection "${collectionName}" not found`,
            },
          ],
        };
      }

      const collectionDir = join(
        options.frozeninkHome,
        "collections",
        collectionName,
      );
      const mdPath = join(collectionDir, path);

      if (!existsSync(mdPath)) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: `Markdown file not found: ${path}`,
            },
          ],
        };
      }

      const content = readFileSync(mdPath, "utf-8");

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/markdown",
            text: content,
          },
        ],
      };
    },
  );
}
