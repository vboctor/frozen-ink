import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import {
  contextExists,
  listCollections,
  getCollection,
  getCollectionDb,
  getCollectionDbPath,
  entities,
  syncRuns,
} from "@veecontext/core";
import { desc } from "drizzle-orm";
import type { McpServerOptions } from "../server";

export function registerCollectionResources(
  server: McpServer,
  options: McpServerOptions,
): void {
  // Static resource: list all collections
  server.registerResource(
    "collections",
    "veecontext://collections",
    {
      description: "List of all configured VeeContext collections",
      mimeType: "application/json",
    },
    async () => {
      if (!contextExists()) {
        return {
          contents: [
            {
              uri: "veecontext://collections",
              mimeType: "application/json",
              text: JSON.stringify({ error: "VeeContext not initialized" }),
            },
          ],
        };
      }

      const rows = listCollections();
      const result = rows.map((col) => ({
        name: col.name,
        crawlerType: col.crawler,
        enabled: col.enabled,
      }));

      return {
        contents: [
          {
            uri: "veecontext://collections",
            mimeType: "application/json",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  // Template resource: single collection details
  const collectionTemplate = new ResourceTemplate(
    "veecontext://collections/{name}",
    {
      list: async () => {
        if (!contextExists()) return { resources: [] };

        const rows = listCollections();

        return {
          resources: rows.map((col) => ({
            uri: `veecontext://collections/${col.name}`,
            name: col.name,
            description: `${col.crawler} collection: ${col.name}`,
            mimeType: "application/json",
          })),
        };
      },
    },
  );

  server.registerResource(
    "collection",
    collectionTemplate,
    {
      description: "Details for a specific VeeContext collection",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const name = variables.name as string;

      if (!contextExists()) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: "VeeContext not initialized" }),
            },
          ],
        };
      }

      const col = getCollection(name);
      if (!col) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: `Collection "${name}" not found` }),
            },
          ],
        };
      }

      let entityCount = 0;
      let lastSyncTime: string | null = null;

      const dbPath = getCollectionDbPath(name);
      if (existsSync(dbPath)) {
        const colDb = getCollectionDb(dbPath);
        entityCount = colDb.select().from(entities).all().length;

        const runs = colDb
          .select()
          .from(syncRuns)
          .orderBy(desc(syncRuns.startedAt))
          .limit(1)
          .all();

        if (runs.length > 0) {
          lastSyncTime = runs[0].startedAt;
        }
      }

      const result = {
        name: col.name,
        crawlerType: col.crawler,
        enabled: col.enabled,
        entityCount,
        lastSyncTime,
        syncInterval: col.syncInterval,
      };

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}
