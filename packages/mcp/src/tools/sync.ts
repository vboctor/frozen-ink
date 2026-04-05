import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "fs";
import { join } from "path";
import {
  getMasterDb,
  getCollectionDb,
  collections,
  syncRuns,
  syncState,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
} from "@veecontext/core";
import { eq, desc } from "drizzle-orm";
import { createDefaultRegistry, gitHubTheme } from "@veecontext/connectors";
import type { McpServerOptions } from "../server";

export function registerSync(
  server: McpServer,
  options: McpServerOptions,
): void {
  server.registerTool(
    "trigger_sync",
    {
      title: "Trigger Sync",
      description:
        "Triggers an immediate sync for a collection and returns the run ID",
      inputSchema: {
        collection: z.string().describe("Collection name to sync"),
        full: z
          .boolean()
          .optional()
          .default(false)
          .describe("Full re-sync (ignore existing cursors)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
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

      if (!col.enabled) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Collection "${args.collection}" is disabled`,
              }),
            },
          ],
        };
      }

      const registry = createDefaultRegistry();
      const factory = registry.get(col.connectorType);
      if (!factory) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `No connector for type: ${col.connectorType}`,
              }),
            },
          ],
        };
      }

      const connector = factory();
      await connector.initialize(
        col.config as Record<string, unknown>,
        col.credentials as Record<string, unknown>,
      );

      if (args.full) {
        const colDb = getCollectionDb(col.dbPath);
        colDb
          .delete(syncState)
          .where(eq(syncState.connectorType, col.connectorType))
          .run();
      }

      const collectionDir = join(
        options.veecontextHome,
        "collections",
        col.name,
      );
      const storage = new LocalStorageBackend(collectionDir);
      const themeEngine = new ThemeEngine();
      themeEngine.register(gitHubTheme);

      const engine = new SyncEngine({
        connector,
        dbPath: col.dbPath,
        collectionName: col.name,
        themeEngine,
        storage,
        markdownBasePath: "markdown",
      });

      try {
        await engine.run();
        await connector.dispose();

        // Get the latest sync run ID
        const colDb = getCollectionDb(col.dbPath);
        const [latestRun] = colDb
          .select()
          .from(syncRuns)
          .orderBy(desc(syncRuns.startedAt))
          .limit(1)
          .all();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "completed",
                runId: latestRun?.id ?? null,
                created: latestRun?.entitiesCreated ?? 0,
                updated: latestRun?.entitiesUpdated ?? 0,
                deleted: latestRun?.entitiesDeleted ?? 0,
              }),
            },
          ],
        };
      } catch (err) {
        await connector.dispose();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "failed",
                error: String(err),
              }),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_sync_status",
    {
      title: "Get Sync Status",
      description: "Returns current sync status for a collection",
      inputSchema: {
        collection: z.string().describe("Collection name"),
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
      const runs = colDb
        .select()
        .from(syncRuns)
        .orderBy(desc(syncRuns.startedAt))
        .limit(5)
        .all();

      const result = {
        collection: col.name,
        enabled: col.enabled,
        runs: runs.map((r) => ({
          id: r.id,
          status: r.status,
          entitiesCreated: r.entitiesCreated,
          entitiesUpdated: r.entitiesUpdated,
          entitiesDeleted: r.entitiesDeleted,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          errors: r.errors,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
