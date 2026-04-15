import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export interface EntityData {
  source: Record<string, unknown>;
  out_links?: string[];
  in_links?: string[];
  assets?: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }>;
  markdown_mtime?: number | null;
  markdown_size?: number | null;
  markdown_path?: string | null;
  url?: string | null;
  tags?: string[] | null;
}

export const entities = sqliteTable("entities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  entityType: text("entity_type").notNull(),
  title: text("title").notNull(),
  data: text("data", { mode: "json" }).notNull().$type<EntityData>(),
  contentHash: text("content_hash"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
