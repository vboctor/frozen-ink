import { openDatabase } from "../compat/sqlite";
import { isBun } from "../compat/runtime";
import * as collectionSchema from "./collection-schema";
import { runSyncMigrations, LOCAL_MIGRATIONS } from "./migrations";

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

/**
 * Open (or create) a collection's SQLite database and run any pending
 * schema migrations from `LOCAL_MIGRATIONS`. The migration runner caches
 * the verified version in-memory, so subsequent calls in the same process
 * are effectively free.
 *
 * Schema changes go through migrations — never inline `CREATE TABLE` /
 * `ALTER TABLE` here. See `SCHEMA.md` for the migration list.
 */
export function getCollectionDb(dbPath: string) {
  const sqlite = openDatabase(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  runSyncMigrations(sqlite, LOCAL_MIGRATIONS, dbPath);

  return createDrizzle(sqlite);
}
