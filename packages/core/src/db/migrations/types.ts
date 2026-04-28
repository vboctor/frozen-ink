/**
 * Schema migration framework.
 *
 * Every change to the on-disk SQLite schema OR the published Cloudflare D1
 * schema must land here as a numbered migration with a matching entry in
 * `SCHEMA.md`. The migration runner records the latest applied id in the
 * `metadata` table under `schema.version` so subsequent loads are O(1).
 *
 * Two flavours: the local SQLite handle is synchronous (used inside
 * `getCollectionDb`, which is itself sync), and D1 is async. The two
 * physical schemas differ in places (FTS `collection_name`, the
 * `r2_manifest` table, etc.) so they have separate migration lists.
 *
 * **Idempotence rule.** Every migration body must be safe to re-run
 * against a partially-applied DB. Use `CREATE TABLE IF NOT EXISTS`,
 * `PRAGMA table_info` checks, etc. — never assume the previous migration
 * succeeded. This protects against partial failures and lets us run all
 * migrations on legacy DBs that don't have a `schema.version` recorded.
 */

/** Schema version key in the `metadata` table. */
export const SCHEMA_VERSION_KEY = "schema.version";

/** Synchronous DB handle abstraction — matches `bun:sqlite` / `better-sqlite3`. */
export interface SyncMigrationDb {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
}

/** Async DB handle abstraction for D1 / remote SQL endpoints. */
export interface AsyncMigrationDb {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

/** A single sync schema migration. */
export interface SyncMigration {
  /** Sequential, gap-free id starting at 1. */
  id: number;
  /** One-line summary; surfaced in logs and SCHEMA.md. */
  description: string;
  /** Idempotent body. May read the DB to detect prior state. */
  up(db: SyncMigrationDb): void;
}

/** A single async schema migration. */
export interface AsyncMigration {
  id: number;
  description: string;
  up(db: AsyncMigrationDb): Promise<void>;
}
