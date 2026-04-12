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
      markdown_path TEXT,
      markdown_mtime REAL,
      markdown_size INTEGER,
      url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS entity_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      tag_id INTEGER NOT NULL REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      storage_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crawler_type TEXT NOT NULL,
      cursor TEXT,
      crawler_version TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      sync_type TEXT NOT NULL DEFAULT 'incremental',
      entities_created INTEGER NOT NULL DEFAULT 0,
      entities_updated INTEGER NOT NULL DEFAULT 0,
      entities_deleted INTEGER NOT NULL DEFAULT 0,
      errors TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL REFERENCES entities(id),
      target_entity_id INTEGER NOT NULL REFERENCES entities(id)
    );

    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_entity_id);
    CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_entity_id);
  `);

  // Migrations: add columns to existing tables
  try {
    sqlite.exec("ALTER TABLE sync_runs ADD COLUMN sync_type TEXT NOT NULL DEFAULT 'incremental'");
  } catch {
    // Column already exists — expected on new databases
  }
  try {
    sqlite.exec("ALTER TABLE sync_state ADD COLUMN crawler_version TEXT");
  } catch {
    // Column already exists — expected on new databases
  }

  return db;
}
