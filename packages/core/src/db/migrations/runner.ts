import type {
  AsyncMigration,
  AsyncMigrationDb,
  SyncMigration,
  SyncMigrationDb,
} from "./types";
import { SCHEMA_VERSION_KEY } from "./types";

/*
 * The hot path is just `ensureMetadataTable` + a single primary-key SELECT
 * against `metadata` — well under a microsecond on local SQLite and a
 * single D1 round-trip on the worker (which only happens at publish time
 * anyway). We deliberately don't cache the verified version in-process
 * because tests routinely delete + recreate DB files at the same path,
 * which a cache would mis-treat as "already migrated".
 */

function ensureMetadataTableSync(db: SyncMigrationDb): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  );
}

async function ensureMetadataTableAsync(db: AsyncMigrationDb): Promise<void> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  );
}

function readSchemaVersionSync(db: SyncMigrationDb): number {
  const row = db.prepare(
    `SELECT value FROM metadata WHERE key = '${SCHEMA_VERSION_KEY}'`,
  ).get() as { value: string } | undefined;
  if (!row) return 0;
  const n = Number.parseInt(row.value, 10);
  return Number.isFinite(n) ? n : 0;
}

async function readSchemaVersionAsync(db: AsyncMigrationDb): Promise<number> {
  const rows = await db.query<{ value: string }>(
    `SELECT value FROM metadata WHERE key = '${SCHEMA_VERSION_KEY}'`,
  );
  if (!rows[0]) return 0;
  const n = Number.parseInt(rows[0].value, 10);
  return Number.isFinite(n) ? n : 0;
}

function writeSchemaVersionSync(db: SyncMigrationDb, version: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO metadata (key, value) VALUES ('${SCHEMA_VERSION_KEY}', ?)`,
  ).run(String(version));
}

async function writeSchemaVersionAsync(
  db: AsyncMigrationDb,
  version: number,
): Promise<void> {
  await db.exec(
    `INSERT OR REPLACE INTO metadata (key, value) VALUES ('${SCHEMA_VERSION_KEY}', '${version}');`,
  );
}

/** Result of a migration pass. */
export interface MigrationResult {
  /** Schema version after the run. */
  current: number;
  /** Ids that were applied during this run (empty if already up-to-date). */
  applied: number[];
}

/**
 * Run every pending migration against a synchronous SQLite handle and
 * record the new schema version in the `metadata` table. Cheap (one
 * SELECT) when the DB is already current.
 *
 * `cacheKey` is accepted for API symmetry with `runAsyncMigrations` but
 * currently unused; included so callers can pre-thread a key for any
 * future opt-in caching.
 */
export function runSyncMigrations(
  db: SyncMigrationDb,
  migrations: SyncMigration[],
  _cacheKey?: string,
): MigrationResult {
  if (migrations.length === 0) return { current: 0, applied: [] };
  const latest = migrations[migrations.length - 1].id;

  ensureMetadataTableSync(db);
  const current = readSchemaVersionSync(db);
  if (current === latest) {
    return { current, applied: [] };
  }

  const applied: number[] = [];
  for (const m of migrations) {
    if (m.id <= current) continue;
    m.up(db);
    applied.push(m.id);
  }
  writeSchemaVersionSync(db, latest);
  return { current: latest, applied };
}

/** Async variant for D1 / remote SQL endpoints. Same semantics. */
export async function runAsyncMigrations(
  db: AsyncMigrationDb,
  migrations: AsyncMigration[],
  _cacheKey?: string,
): Promise<MigrationResult> {
  if (migrations.length === 0) return { current: 0, applied: [] };
  const latest = migrations[migrations.length - 1].id;

  await ensureMetadataTableAsync(db);
  const current = await readSchemaVersionAsync(db);
  if (current === latest) {
    return { current, applied: [] };
  }

  const applied: number[] = [];
  for (const m of migrations) {
    if (m.id <= current) continue;
    await m.up(db);
    applied.push(m.id);
  }
  await writeSchemaVersionAsync(db, latest);
  return { current: latest, applied };
}

/** Kept for API stability — no internal cache to clear. */
export function _clearMigrationCacheForTests(): void {
  /* no-op */
}
