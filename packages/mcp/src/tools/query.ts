import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "fs";
import { join } from "path";
import {
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  entityTags,
} from "@veecontext/core";
import { eq, desc, asc, like, and, type SQL } from "drizzle-orm";
import type { McpServerOptions } from "../server";

export function registerQuery(
  server: McpServer,
  options: McpServerOptions,
): void {
  server.registerTool(
    "query_entities",
    {
      title: "Query Entities",
      description:
        "Structured query with field filters, ordering, and pagination across entities",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        entityType: z
          .string()
          .optional()
          .describe("Filter by entity type"),
        titleContains: z
          .string()
          .optional()
          .describe("Filter entities whose title contains this string"),
        tag: z.string().optional().describe("Filter by tag"),
        orderBy: z
          .enum(["title", "createdAt", "updatedAt"])
          .optional()
          .default("updatedAt")
          .describe("Field to order by"),
        orderDirection: z
          .enum(["asc", "desc"])
          .optional()
          .default("desc")
          .describe("Sort direction"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(50)
          .describe("Maximum results"),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .default(0)
          .describe("Offset for pagination"),
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

      // Build where conditions
      const conditions: SQL[] = [];
      if (args.entityType) {
        conditions.push(eq(entities.entityType, args.entityType));
      }
      if (args.titleContains) {
        conditions.push(like(entities.title, `%${args.titleContains}%`));
      }

      const baseQuery = colDb.select().from(entities);
      const filtered = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

      // Apply ordering
      const orderCol =
        args.orderBy === "title"
          ? entities.title
          : args.orderBy === "createdAt"
            ? entities.createdAt
            : entities.updatedAt;
      const orderFn = args.orderDirection === "asc" ? asc : desc;

      const rows = filtered
        .orderBy(orderFn(orderCol))
        .limit(args.limit)
        .offset(args.offset)
        .all();

      // Filter by tag if specified
      let filteredRows = rows;
      if (args.tag) {
        const entityIds = new Set(
          colDb
            .select()
            .from(entityTags)
            .where(eq(entityTags.tag, args.tag))
            .all()
            .map((t) => t.entityId),
        );
        filteredRows = rows.filter((r) => entityIds.has(r.id));
      }

      const result = filteredRows.map((r) => ({
        id: r.id,
        externalId: r.externalId,
        entityType: r.entityType,
        title: r.title,
        url: r.url,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ entities: result, total: result.length }),
          },
        ],
      };
    },
  );
}
