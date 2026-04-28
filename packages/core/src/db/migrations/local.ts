import type { SyncMigration } from "./types";
import { ENTITIES_INDEX_DDL } from "./shared";

/**
 * Schema migrations for the **local** SQLite collection database
 * (`~/.frozenink/collections/<name>/db/data.db`). Numbered, append-only —
 * never edit a published migration; add a new one instead.
 *
 * Document each change in `SCHEMA.md` at the repo root. Worker (D1)
 * migrations live in `./worker.ts`; keep the two in lockstep per the
 * "Local ↔ worker parity rule" in AGENTS.md.
 */
export const LOCAL_MIGRATIONS: SyncMigration[] = [
  {
    id: 1,
    description:
      "Baseline: entities table (with folder/slug + indexes), sync_errors journal, metadata table, legacy markdown_path → folder/slug backfill.",
    up: (db) => {
      db.exec(`
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

      // Pre-baseline DBs predated folder/slug; ALTER ADD COLUMN is idempotent
      // via try/catch since SQLite has no `IF NOT EXISTS` for columns.
      for (const col of ["folder TEXT", "slug TEXT"]) {
        try {
          db.exec(`ALTER TABLE entities ADD COLUMN ${col}`);
        } catch {
          // column already present
        }
      }

      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_entities_external ON entities(external_id);",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_entities_folder   ON entities(folder, slug);",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_entities_type     ON entities(entity_type);",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_entities_updated  ON entities(updated_at);",
      );

      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_errors (
          external_id    TEXT PRIMARY KEY,
          entity_type    TEXT NOT NULL,
          error          TEXT NOT NULL,
          attempts       INTEGER NOT NULL DEFAULT 1,
          first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // One-time backfill: migrate legacy `data.markdown_path` rows into
      // structured `folder` + `slug` columns. Idempotent — only touches
      // rows that still have markdown_path. Runs in 500-row batches so
      // very large legacy DBs don't blow out the prepared-statement cache.
      const needsBackfill = db.prepare(
        "SELECT id, json_extract(data, '$.markdown_path') as mp FROM entities WHERE folder IS NULL AND json_extract(data, '$.markdown_path') IS NOT NULL LIMIT 500",
      );
      const updateFolderSlug = db.prepare(
        "UPDATE entities SET folder = ?, slug = ? WHERE id = ?",
      );
      const stripOldFields = db.prepare(
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

      stripOldFields.run();
    },
  },
  {
    id: 2,
    description:
      "Add `entities_fts` virtual table (FTS5) with collection_name / entity_id / external_id / entity_type / title / content / tags. Includes drop+recreate when an older 6-column FTS (no collection_name) is detected.",
    up: (db) => {
      // Detect a pre-existing legacy FTS table that lacks the
      // collection_name column. FTS5 doesn't support ALTER TABLE ADD
      // COLUMN, so the only path is drop + recreate. The SyncEngine
      // re-INSERTs FTS rows on the next sync.
      try {
        const cols = db.prepare("PRAGMA table_info(entities_fts)").all() as Array<{ name: string }>;
        const hasCollectionName = cols.some((c) => c.name === "collection_name");
        if (cols.length > 0 && !hasCollectionName) {
          db.exec("DROP TABLE IF EXISTS entities_fts");
        }
      } catch {
        // Table doesn't exist yet — fresh DB.
      }
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
          collection_name UNINDEXED,
          entity_id UNINDEXED,
          external_id UNINDEXED,
          entity_type UNINDEXED,
          title,
          content,
          tags
        );
      `);
    },
  },
  {
    id: 3,
    description:
      "Add `attachment_text` column to `entities_fts` for OCR'd / extracted text from images and PDFs. Drop+recreate (FTS5 has no ALTER ADD COLUMN); SyncEngine re-INSERTs FTS rows on the next sync.",
    up: (db) => {
      let needsRebuild = false;
      try {
        const cols = db.prepare("PRAGMA table_info(entities_fts)").all() as Array<{ name: string }>;
        if (cols.length > 0 && !cols.some((c) => c.name === "attachment_text")) {
          needsRebuild = true;
        }
      } catch {
        // Table missing — IF NOT EXISTS below creates the new shape.
      }
      if (needsRebuild) {
        db.exec("DROP TABLE IF EXISTS entities_fts");
      }
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
          collection_name UNINDEXED,
          entity_id UNINDEXED,
          external_id UNINDEXED,
          entity_type UNINDEXED,
          title,
          content,
          tags,
          attachment_text
        );
      `);
    },
  },
  {
    id: 4,
    description:
      "Schema cleanup to align with the worker schema: drop `collection_name` from `entities_fts` (it was never queried), and drop `AUTOINCREMENT` from `entities.id` (worker has plain INTEGER PRIMARY KEY). FTS row repopulation happens on next sync.",
    up: (db) => {
      // ── Part 1: drop `collection_name` from entities_fts ──
      // FTS5 has no DROP COLUMN, so detect + recreate. Idempotent: skip
      // if the column is already absent (fresh DB, or migration already
      // ran on this DB).
      let ftsNeedsRebuild = false;
      try {
        const cols = db
          .prepare("PRAGMA table_info(entities_fts)")
          .all() as Array<{ name: string }>;
        if (cols.length > 0 && cols.some((c) => c.name === "collection_name")) {
          ftsNeedsRebuild = true;
        }
      } catch {
        // Table missing; CREATE IF NOT EXISTS below handles it.
      }
      if (ftsNeedsRebuild) {
        db.exec("DROP TABLE IF EXISTS entities_fts");
      }
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
          entity_id UNINDEXED,
          external_id UNINDEXED,
          entity_type UNINDEXED,
          title,
          content,
          tags,
          attachment_text
        );
      `);

      // ── Part 2: drop AUTOINCREMENT from entities ──
      // ALTER TABLE can't change PRIMARY KEY semantics. Detect via
      // sqlite_master.sql — if the historical CREATE statement contains
      // "AUTOINCREMENT", rebuild the table by copying rows into a
      // correctly-shaped clone and renaming. Idempotent: skips when the
      // current schema already lacks AUTOINCREMENT (worker-shape DB).
      const masterRow = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='entities'",
        )
        .get() as { sql: string } | undefined;
      if (masterRow && /AUTOINCREMENT/i.test(masterRow.sql)) {
        // Wrap in a transaction so a partial failure doesn't leave the
        // DB without an `entities` table.
        db.exec("BEGIN");
        try {
          db.exec(`
            CREATE TABLE entities_v4_new (
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
            );
          `);
          db.exec(`
            INSERT INTO entities_v4_new (
              id, external_id, entity_type, title, data,
              content_hash, folder, slug, created_at, updated_at
            )
            SELECT id, external_id, entity_type, title, data,
                   content_hash, folder, slug, created_at, updated_at
            FROM entities;
          `);
          db.exec("DROP TABLE entities");
          db.exec("ALTER TABLE entities_v4_new RENAME TO entities");
          // Rebuild indexes — DROP TABLE removed them along with the table.
          for (const sql of ENTITIES_INDEX_DDL) {
            db.exec(sql);
          }
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      }
    },
  },
];
