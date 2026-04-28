/**
 * SQL fragments shared between the local and worker schemas. Anything
 * here is by definition the SAME on both sides — adding a column or
 * index here must be safe for both runtimes.
 *
 * Per-runtime divergences (currently just `sync_errors`, which is
 * local-only) live in each list's own migration body, NOT here.
 */

/**
 * `entities` table DDL — the central row store. Identical on local and
 * worker after `LOCAL_MIGRATIONS` v4 (which drops the local-only
 * `AUTOINCREMENT` to align with worker). No `AUTOINCREMENT`: SQLite's
 * implicit ROWID semantics are sufficient — we never delete entities by
 * id, and reused ids would only matter if FTS rows for deleted entities
 * weren't being cleaned up (they are, via `DELETE FROM entities_fts`
 * before any INSERT).
 */
export const ENTITIES_TABLE_DDL = `CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT,
  folder TEXT,
  slug TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

/** Indexes on `entities` — same on both runtimes. */
export const ENTITIES_INDEX_DDL: ReadonlyArray<string> = [
  "CREATE INDEX IF NOT EXISTS idx_entities_external ON entities(external_id);",
  "CREATE INDEX IF NOT EXISTS idx_entities_folder   ON entities(folder, slug);",
  "CREATE INDEX IF NOT EXISTS idx_entities_type     ON entities(entity_type);",
  "CREATE INDEX IF NOT EXISTS idx_entities_updated  ON entities(updated_at);",
];
