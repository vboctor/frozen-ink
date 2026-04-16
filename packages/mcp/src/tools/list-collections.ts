import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import {
  contextExists,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  getCollectionSyncState,
  entities,
} from "@frozenink/core";
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
        "Discover what knowledge sources are available in Frozen Ink. Call this first to see collection names, types, and sizes before searching. Each collection is a different data source (GitHub repo, notes vault, git history, issue tracker, etc.).",
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
        const dbPath = getCollectionDbPath(col.name);
        if (existsSync(dbPath)) {
          const colDb = getCollectionDb(dbPath);
          entityCount = colDb.select().from(entities).all().length;
        }
        const sync = getCollectionSyncState(dbPath);

        return {
          name: col.name,
          crawlerType: col.crawler,
          enabled: col.enabled,
          entityCount,
          lastSyncTime: sync.lastAt ?? null,
          lastSyncStatus: sync.lastStatus ?? null,
        };
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
