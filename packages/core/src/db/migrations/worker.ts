import type { AsyncMigration } from "./types";

/**
 * Schema migrations for the **published Cloudflare D1** database that
 * each worker owns. The shape differs from the local DB in a few places:
 *
 * - No `collection_name` column on `entities_fts` (each worker is a
 *   single collection)
 * - No backfill loops or legacy migrations from before publish existed
 * - `entities.id` isn't AUTOINCREMENT (D1 limitations + we use
 *   `INSERT OR REPLACE` keyed on external_id)
 *
 * Local migrations live in `./local.ts`; document each change in the
 * top-level `SCHEMA.md`.
 */
export const WORKER_MIGRATIONS: AsyncMigration[] = [
  {
    id: 1,
    description:
      "Baseline: entities table + indexes, entities_fts virtual table (entity_id / external_id / entity_type / title / content / tags).",
    up: async (db) => {
      await db.exec(`CREATE TABLE IF NOT EXISTS entities (
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
);`);
      await db.exec("CREATE INDEX IF NOT EXISTS idx_entities_external ON entities(external_id);");
      await db.exec("CREATE INDEX IF NOT EXISTS idx_entities_folder   ON entities(folder, slug);");
      await db.exec("CREATE INDEX IF NOT EXISTS idx_entities_type     ON entities(entity_type);");
      await db.exec("CREATE INDEX IF NOT EXISTS idx_entities_updated  ON entities(updated_at);");
      await db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags);",
      );
    },
  },
  {
    id: 2,
    description:
      "Add `attachment_text` column to `entities_fts` for OCR'd attachment text. FTS5 doesn't support ALTER ADD COLUMN, so detect via PRAGMA, drop + recreate, and let the publish path re-INSERT every FTS row in the same run.",
    up: async (db) => {
      let needsRebuild = false;
      try {
        const cols = await db.query<{ name: string }>("PRAGMA table_info(entities_fts);");
        if (cols.length > 0 && !cols.some((c) => c.name === "attachment_text")) {
          needsRebuild = true;
        }
      } catch {
        // Table missing — IF NOT EXISTS below creates the new shape.
      }
      if (needsRebuild) {
        await db.exec("DROP TABLE IF EXISTS entities_fts;");
      }
      await db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags, attachment_text);",
      );
    },
  },
];

/**
 * True when the publish path needs to force-include every entity in the
 * FTS push set — i.e. one of the migrations dropped + recreated
 * `entities_fts`. The publish flow normally relies on a
 * content-hash-driven manifest delta; that's not enough when the FTS
 * table itself was reset, since unchanged entities still need their FTS
 * rows re-INSERTed.
 *
 * Returns true when the version on disk before the run was below the
 * "added attachment_text" migration.
 */
export const FTS_RESET_FROM_BELOW = 2;
