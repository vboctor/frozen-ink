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
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const entityTags = sqliteTable("entity_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityId: integer("entity_id")
    .notNull()
    .references(() => entities.id),
  tag: text("tag").notNull(),
});

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityId: integer("entity_id")
    .notNull()
    .references(() => entities.id),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  storagePath: text("storage_path").notNull(),
  backend: text("backend").notNull(),
});

export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  crawlerType: text("crawler_type").notNull(),
  cursor: text("cursor", { mode: "json" }).$type<Record<string, unknown>>(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull(),
  entitiesCreated: integer("entities_created").notNull().default(0),
  entitiesUpdated: integer("entities_updated").notNull().default(0),
  entitiesDeleted: integer("entities_deleted").notNull().default(0),
  errors: text("errors", { mode: "json" }).$type<unknown[]>(),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
});

export const entityRelations = sqliteTable("entity_relations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceEntityId: integer("source_entity_id")
    .notNull()
    .references(() => entities.id),
  targetEntityId: integer("target_entity_id")
    .notNull()
    .references(() => entities.id),
  relationType: text("relation_type").notNull(),
});
