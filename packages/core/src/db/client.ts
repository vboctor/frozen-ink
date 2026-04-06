import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as collectionSchema from "./collection-schema";
import * as masterSchema from "./master-schema";

const COLLECTION_KEY_RE = /^[a-zA-Z0-9_-]+$/;

/** Validate a collection key: alphanumeric, underscore, dash only. */
export function isValidCollectionKey(key: string): boolean {
  return COLLECTION_KEY_RE.test(key);
}

export function getMasterDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(sqlite, { schema: masterSchema });

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      crawler_type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT ('{}'),
      credentials TEXT NOT NULL DEFAULT ('{}'),
      db_path TEXT NOT NULL,
      sync_interval INTEGER NOT NULL DEFAULT 3600,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

export function getCollectionDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(sqlite, { schema: collectionSchema });

  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      title TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT,
      markdown_path TEXT,
      markdown_mtime REAL,
      markdown_size INTEGER,
      url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entity_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      tag TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      backend TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crawler_type TEXT NOT NULL,
      cursor TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      entities_created INTEGER NOT NULL DEFAULT 0,
      entities_updated INTEGER NOT NULL DEFAULT 0,
      entities_deleted INTEGER NOT NULL DEFAULT 0,
      errors TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS entity_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL REFERENCES entities(id),
      target_entity_id INTEGER NOT NULL REFERENCES entities(id),
      relation_type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL REFERENCES entities(id),
      source_markdown_path TEXT NOT NULL,
      target_path TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links(target_path);
  `);

  return db;
}
