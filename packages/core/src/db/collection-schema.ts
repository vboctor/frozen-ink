import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const entities = sqliteTable("entities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  entityType: text("entity_type").notNull(),
  title: text("title").notNull(),
  data: text("data", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  contentHash: text("content_hash"),
  markdownPath: text("markdown_path"),
  markdownMtime: real("markdown_mtime"),
  markdownSize: integer("markdown_size"),
  url: text("url"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  outLinks: text("out_links", { mode: "json" }).$type<string[]>(),
  inLinks: text("in_links", { mode: "json" }).$type<string[]>(),
  assets: text("assets", { mode: "json" }).$type<Array<{ filename: string; mimeType: string; storagePath: string; hash: string }>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

