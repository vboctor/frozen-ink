import { basename, dirname } from "path";
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
  `);

  // Migration: copy legacy state tables into the collection YAML, then drop them.
  // Derive collection name from dbPath: .../collections/<name>/db/data.db
  const collectionName = basename(dirname(dirname(dbPath)));
  const hasTables = (names: string[]) =>
    names.some(
      (n) =>
        (sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(n) as unknown) !== null,
    );

  if (hasTables(["collection_state", "sync_state"])) {
    // Lazy-import to avoid circular deps at module load time
    const { getCollection, updateCollection } = require("../config/context") as typeof import("../config/context");
    const existing = getCollection(collectionName);
    if (existing) {
      const updates: Record<string, unknown> = {};

      // Migrate collection_state → YAML sync status fields
      if (!existing.lastSyncAt) {
        try {
          const row = sqlite
            .prepare(`SELECT lastSyncStatus, lastSyncAt, lastSyncCreated, lastSyncUpdated, lastSyncDeleted FROM collection_state WHERE id = 1`)
            .get() as Record<string, unknown> | null;
          if (row) {
            if (row.lastSyncStatus) updates.lastSyncStatus = row.lastSyncStatus;
            if (row.lastSyncAt) updates.lastSyncAt = row.lastSyncAt;
            if (typeof row.lastSyncCreated === "number") updates.lastSyncCreated = row.lastSyncCreated;
            if (typeof row.lastSyncUpdated === "number") updates.lastSyncUpdated = row.lastSyncUpdated;
            if (typeof row.lastSyncDeleted === "number") updates.lastSyncDeleted = row.lastSyncDeleted;
          }
        } catch { /* table missing or schema mismatch — skip */ }
      }

      // Migrate sync_state cursor → YAML syncCursor
      if (!existing.syncCursor) {
        try {
          const row = sqlite
            .prepare(`SELECT cursor FROM sync_state LIMIT 1`)
            .get() as Record<string, unknown> | null;
          if (row?.cursor) {
            const cursor = typeof row.cursor === "string" ? JSON.parse(row.cursor) : row.cursor;
            if (cursor) updates.syncCursor = cursor;
          }
        } catch { /* table missing or schema mismatch — skip */ }
      }

      if (Object.keys(updates).length > 0) {
        updateCollection(collectionName, updates as Parameters<typeof updateCollection>[1]);
      }
    }
  }

  // Drop legacy state tables (state now lives in the collection YAML file)
  sqlite.exec(`
    DROP TABLE IF EXISTS sync_runs;
    DROP TABLE IF EXISTS sync_state;
    DROP TABLE IF EXISTS collection_state;
    DROP TABLE IF EXISTS clone_sync_state;
  `);

  // Migrations: add columns to existing tables
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
