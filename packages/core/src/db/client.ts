import { openDatabase } from "../compat/sqlite";
import { isBun } from "../compat/runtime";
import * as collectionSchema from "./collection-schema";

const COLLECTION_KEY_RE = /^[a-zA-Z0-9_-]+$/;

/** Validate a collection key: alphanumeric, underscore, dash only. */
export function isValidCollectionKey(key: string): boolean {
  return COLLECTION_KEY_RE.test(key);
}

function createDrizzle(sqlite: any) {
  if (isBun) {
    const { drizzle } = require("drizzle-orm/bun-sqlite");
    return drizzle(sqlite, { schema: collectionSchema });
  }
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  return drizzle(sqlite, { schema: collectionSchema });
}

export function getCollectionDb(dbPath: string) {
  const sqlite = openDatabase(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = createDrizzle(sqlite);

  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      title TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT,
      folder TEXT,
      slug TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe schema upgrade for existing DBs
  for (const col of ["folder TEXT", "slug TEXT"]) {
    try { sqlite.exec(`ALTER TABLE entities ADD COLUMN ${col}`); } catch {}
  }

  // Ensure indexes exist (safe on new and existing DBs)
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_entities_external ON entities(external_id);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_entities_folder   ON entities(folder, slug);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_entities_type     ON entities(entity_type);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_entities_updated  ON entities(updated_at);")

  // Per-entity sync failure journal. Created lazily on first DB open so existing
  // collections gain it without an explicit migration step.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sync_errors (
      external_id    TEXT PRIMARY KEY,
      entity_type    TEXT NOT NULL,
      error          TEXT NOT NULL,
      attempts       INTEGER NOT NULL DEFAULT 1,
      first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // One-time backfill: populate folder/slug from data.markdown_path for existing rows
  const needsBackfill = sqlite.prepare(
    "SELECT id, json_extract(data, '$.markdown_path') as mp FROM entities WHERE folder IS NULL AND json_extract(data, '$.markdown_path') IS NOT NULL LIMIT 500",
  );
  const updateFolderSlug = sqlite.prepare(
    "UPDATE entities SET folder = ?, slug = ? WHERE id = ?",
  );
  const stripOldFields = sqlite.prepare(
    "UPDATE entities SET data = json_remove(data, '$.markdown_path', '$.markdown_mtime', '$.markdown_size') WHERE json_extract(data, '$.markdown_path') IS NOT NULL OR json_extract(data, '$.markdown_mtime') IS NOT NULL",
  );

  let batch: Array<{ id: number; mp: string }>;
  do {
    batch = needsBackfill.all() as Array<{ id: number; mp: string }>;
    for (const row of batch) {
      const lastSlash = row.mp.lastIndexOf("/");
      const folder = lastSlash >= 0 ? row.mp.slice(0, lastSlash) : "";
      const slug = row.mp.slice(lastSlash + 1).replace(/\.md$/, "");
      updateFolderSlug.run(folder, slug, row.id);
    }
  } while (batch.length > 0);

  // Strip removed fields from data JSON
  stripOldFields.run();

  return db;
}
