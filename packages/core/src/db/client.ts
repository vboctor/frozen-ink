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
      tags TEXT,
      out_links TEXT,
      in_links TEXT,
      assets TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crawler_type TEXT NOT NULL,
      cursor TEXT,
      crawler_version TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collection_state (
      id INTEGER PRIMARY KEY,
      last_sync_status TEXT,
      last_sync_at TEXT,
      last_sync_created INTEGER DEFAULT 0,
      last_sync_updated INTEGER DEFAULT 0,
      last_sync_deleted INTEGER DEFAULT 0,
      last_sync_errors TEXT,
      last_published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clone_sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      protocol_version INTEGER NOT NULL DEFAULT 1,
      last_manifest TEXT NOT NULL,
      last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: migrate sync_runs → collection_state
  try {
    const hasSyncRuns = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_runs'").get();
    if (hasSyncRuns) {
      const lastRun = sqlite.prepare("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1").get() as any;
      if (lastRun) {
        sqlite.exec(`INSERT OR REPLACE INTO collection_state (id, last_sync_status, last_sync_at, last_sync_created, last_sync_updated, last_sync_deleted, last_sync_errors) VALUES (1, '${lastRun.status}', '${lastRun.started_at}', ${lastRun.entities_created}, ${lastRun.entities_updated}, ${lastRun.entities_deleted}, ${lastRun.errors ? `'${String(lastRun.errors).replace(/'/g, "''")}'` : "NULL"})`);
      }
      sqlite.exec("DROP TABLE sync_runs");
    }
  } catch {
    // Migration may have already run
  }

  // Migrations: add columns to existing tables
  try {
    sqlite.exec("ALTER TABLE sync_state ADD COLUMN crawler_version TEXT");
  } catch {
    // Column already exists — expected on new databases
  }
  for (const col of ["tags", "out_links", "in_links", "assets"]) {
    try {
      sqlite.exec(`ALTER TABLE entities ADD COLUMN ${col} TEXT`);
    } catch {
      // Column already exists
    }
  }

  // Migration: strip content/ prefix from markdown_path
  sqlite.exec(`UPDATE entities SET markdown_path = substr(markdown_path, 9) WHERE markdown_path LIKE 'content/%'`);

  return db;
}
