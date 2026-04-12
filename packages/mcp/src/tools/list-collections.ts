import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import {
  contextExists,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  entities,
  syncRuns,
} from "@frozenink/core";
import { desc } from "drizzle-orm";
import type { McpServerOptions } from "../server";
import { filterAllowedCollections } from "../collection-scope";

export function registerListCollections(
  server: McpServer,
  options: McpServerOptions,
): void {
  server.registerTool(
    "collection_list",
    {
      title: "List Collections",
      description:
        "Lists all configured collections with entity counts and last sync time",
      annotations: { readOnlyHint: true },
    },
    async () => {
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

      const rows = filterAllowedCollections(options, listCollections());

      const result = rows.map((col) => {
        let entityCount = 0;
        let lastSyncTime: string | null = null;
        let lastSyncStatus: string | null = null;

        const dbPath = getCollectionDbPath(col.name);
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
            lastSyncStatus = runs[0].status;
          }
        }

        return {
          name: col.name,
          crawlerType: col.crawler,
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
