import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export interface EntityData {
  source: Record<string, unknown>;
  out_links?: string[];
  in_links?: string[];
  assets?: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }>;
  url?: string | null;
  tags?: string[] | null;
}

/** Reconstruct the relative markdown path from folder/slug columns. */
export function entityMarkdownPath(
  folder: string | null | undefined,
  slug: string | null | undefined,
): string | null {
  if (folder == null || slug == null) return null;
  return folder ? `${folder}/${slug}.md` : `${slug}.md`;
}

/** Split a relative markdown path into folder and slug. */
export function splitMarkdownPath(mdPath: string | null | undefined): {
  folder: string | null;
  slug: string | null;
} {
  if (!mdPath) return { folder: null, slug: null };
  const lastSlash = mdPath.lastIndexOf("/");
  return {
    folder: lastSlash >= 0 ? mdPath.slice(0, lastSlash) : "",
    slug: mdPath.slice(lastSlash + 1).replace(/\.md$/, ""),
  };
}

export const entities = sqliteTable("entities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  entityType: text("entity_type").notNull(),
  title: text("title").notNull(),
  data: text("data", { mode: "json" }).notNull().$type<EntityData>(),
  contentHash: text("content_hash"),
  folder: text("folder"),
  slug: text("slug"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/**
 * Per-entity sync failure journal. Populated by the SyncEngine when a crawler
 * reports a recoverable failure for a specific entity. Rows are removed when
 * the entity is successfully synced. Cleared on full re-sync.
 */
export const syncErrors = sqliteTable("sync_errors", {
  externalId: text("external_id").primaryKey(),
  entityType: text("entity_type").notNull(),
  error: text("error").notNull(),
  attempts: integer("attempts").notNull().default(1),
  firstSeenAt: text("first_seen_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  lastSeenAt: text("last_seen_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
