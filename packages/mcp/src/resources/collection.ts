import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import { join } from "path";
import {
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  syncRuns,
} from "@veecontext/core";
import { eq, desc } from "drizzle-orm";
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
      const masterDbPath = join(options.veecontextHome, "master.db");
      if (!existsSync(masterDbPath)) {
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

      const db = getMasterDb(masterDbPath);
      const rows = db.select().from(collections).all();

      const result = rows.map((col) => ({
        name: col.name,
        connectorType: col.connectorType,
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
        const masterDbPath = join(options.veecontextHome, "master.db");
        if (!existsSync(masterDbPath)) return { resources: [] };

        const db = getMasterDb(masterDbPath);
        const rows = db.select().from(collections).all();

        return {
          resources: rows.map((col) => ({
            uri: `veecontext://collections/${col.name}`,
            name: col.name,
            description: `${col.connectorType} collection: ${col.name}`,
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
      const masterDbPath = join(options.veecontextHome, "master.db");

      if (!existsSync(masterDbPath)) {
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

      const db = getMasterDb(masterDbPath);
      const [col] = db
        .select()
        .from(collections)
        .where(eq(collections.name, name))
        .all();

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

      if (existsSync(col.dbPath)) {
        const colDb = getCollectionDb(col.dbPath);
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
        connectorType: col.connectorType,
        enabled: col.enabled,
        entityCount,
        lastSyncTime,
        syncInterval: col.syncInterval,
        createdAt: col.createdAt,
        updatedAt: col.updatedAt,
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
