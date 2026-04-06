import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  crawlerType: text("crawler_type").notNull(),
  config: text("config", { mode: "json" })
    .notNull()
    .$type<Record<string, unknown>>()
    .default(sql`'{}'`),
  credentials: text("credentials", { mode: "json" })
    .notNull()
    .$type<Record<string, unknown>>()
    .default(sql`'{}'`),
  dbPath: text("db_path").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  title: text("title"),
  syncInterval: integer("sync_interval").notNull().default(3600),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
