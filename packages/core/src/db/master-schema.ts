import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  connectorType: text("connector_type").notNull(),
  config: text("config", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  credentials: text("credentials", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  syncInterval: integer("sync_interval").notNull().default(3600),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  dbPath: text("db_path").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
