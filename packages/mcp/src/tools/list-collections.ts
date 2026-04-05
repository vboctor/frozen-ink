import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import { join } from "path";
import {
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  syncRuns,
} from "@veecontext/core";
import { desc } from "drizzle-orm";
import type { McpServerOptions } from "../server";

export function registerListCollections(
  server: McpServer,
  options: McpServerOptions,
): void {
  server.registerTool(
    "list_collections",
    {
      title: "List Collections",
      description:
        "Lists all configured collections with entity counts and last sync time",
      annotations: { readOnlyHint: true },
    },
    async () => {
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
      const rows = db.select().from(collections).all();

      const result = rows.map((col) => {
        let entityCount = 0;
        let lastSyncTime: string | null = null;
        let lastSyncStatus: string | null = null;

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
            lastSyncStatus = runs[0].status;
          }
        }

        return {
          name: col.name,
          connectorType: col.connectorType,
          enabled: col.enabled,
          entityCount,
          lastSyncTime,
          lastSyncStatus,
        };
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
