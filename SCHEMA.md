# Schema

This document tracks every change to the on-disk SQLite collection database (local) and the published Cloudflare D1 database (worker). It pairs with the migrations registered in `packages/core/src/db/migrations/`.

## Source of truth

- **Local migrations** — `packages/core/src/db/migrations/local.ts` (`LOCAL_MIGRATIONS`)
- **Worker migrations** — `packages/core/src/db/migrations/worker.ts` (`WORKER_MIGRATIONS`)
- **Schema version** — stored under the `schema.version` key in each database's `metadata` table

The migration runner records the latest applied version once it finishes, and the runner's in-process cache short-circuits subsequent runs in the same process so the hot path issues zero queries.

## Authoring rules

1. **Every schema change goes through migrations.** No inline `CREATE TABLE` / `ALTER TABLE` / FTS recreate elsewhere in the codebase. The runner is called from `getCollectionDb()` (local) and `publishCollections()` (worker) so anything that opens the DB is covered.
2. **Append-only — never edit a published migration.** Add a new id and let the runner apply it. Editing in place breaks every existing collection.
3. **Each migration body must be idempotent.** Re-running it on a partially-applied DB has to be safe. Use `CREATE TABLE IF NOT EXISTS`, `PRAGMA table_info` checks before drops, etc.
4. **Local and worker stay in lockstep.** Per the parity rule in `AGENTS.md`, every PR that touches schema must update both lists in the same commit. The two physical schemas differ in places (FTS `collection_name`, primary-key autoincrement, etc.) — that's fine; the migration ids don't have to match across the two arrays, but the *intent* of each version should.
5. **Document below.** Every numbered migration gets an entry under the appropriate section, with what changed and why.

When a new schema change ships, update **all five**:

- The migration list (local and/or worker)
- This file
- The smoke-test plan in the PR (publish to a scratch worker, verify the new schema is applied)
- `AGENTS.md` if the rules themselves change
- A migration unit test if the change is non-trivial (drop+recreate, backfill, etc.)

## Local schema (`~/.frozenink/collections/<name>/db/data.db`)

Opened via `getCollectionDb()` in `packages/core/src/db/client.ts`. The runner is called automatically; `SearchIndexer` runs the same migrations defensively when it opens its own handle to the same file.

### v1 — Baseline

`entities` table with structured `folder` and `slug` columns plus indexes; `sync_errors` per-entity failure journal; `metadata` key-value store. Includes a one-time, idempotent backfill that populates `folder`/`slug` from the legacy `data.markdown_path` JSON field for collections that predate the column split, then strips the old `markdown_path`/`markdown_mtime`/`markdown_size` keys.

### v2 — Add `entities_fts` virtual table

FTS5 table with columns `collection_name UNINDEXED, entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags`. Detects a pre-existing 6-column FTS (no `collection_name`) via `PRAGMA table_info` and drops + recreates it. SyncEngine re-INSERTs FTS rows on the next sync.

### v3 — Add `attachment_text` column to `entities_fts`

Detect the missing column via `PRAGMA table_info`; drop + recreate the FTS table. FTS5 has no `ALTER TABLE ADD COLUMN`. The local SyncEngine re-INSERTs FTS rows on the next sync, this time including `attachment_text` from each entity's `data.assets[].text`.

### v4 — Schema cleanup to align with the worker schema

Two concurrent changes that minimise the gratuitous local↔worker divergence:

- **Drop `collection_name` from `entities_fts`.** Each local collection has its own SQLite file, so collection scoping is implicit — the column was written but never queried. FTS5 has no DROP COLUMN, so detect via `PRAGMA table_info` then drop+recreate. Final 7-column shape: `entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags, attachment_text` — same as the worker. SyncEngine re-INSERTs FTS rows on the next sync.

- **Drop `AUTOINCREMENT` from `entities.id`.** The historical local table used `INTEGER PRIMARY KEY AUTOINCREMENT` while the worker uses plain `INTEGER PRIMARY KEY`; we never depended on the no-id-reuse guarantee that `AUTOINCREMENT` provides (FTS rows are deleted alongside their entity row before any new INSERT, so collisions can't occur). The migration detects the historical shape via `sqlite_master.sql`, builds a clone table with the new shape, copies all rows preserving their existing ids, drops the original, renames the clone, and rebuilds the indexes. Wrapped in `BEGIN/COMMIT` — partial failure rolls back.

Final FTS bm25 weights used by `SearchIndexer.search()`: `title=10, tags=5, body=1, attachment=0.25` (UNINDEXED columns get weight `1.0` but never match). `snippet()` highlights column index 4 (content). Worker `bm25()` and `snippet()` are kept identical per the parity rule.

## Worker schema (Cloudflare D1)

Created and migrated by `publishCollections()` in `packages/cli/src/commands/publish.ts`. The runner uses an async D1 executor backed by `executeD1Query` / `queryD1Rows` from `wrangler-api.ts`.

After local v4, the **`entities` table and `entities_fts` schema are identical between local and worker**. The remaining intentional differences are:

- `sync_errors` (per-entity sync failure journal) — **local-only**. Sync runs locally; the worker never syncs.
- `r2_manifest` (R2 file index) — **worker-only**. Local has no R2.

Both runtimes share the same `entities` DDL (extracted into `migrations/shared.ts` as `ENTITIES_TABLE_DDL` + `ENTITIES_INDEX_DDL`) and the same FTS column shape. Adding a column to `entities` should mean editing one constant and adding a numbered migration to both lists.

### v1 — Baseline

`entities` table with the same columns/indexes as the local v1; `entities_fts` virtual table with `entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED, title, content, tags`.

### v2 — Add `attachment_text` column to `entities_fts`

Same idea as local v3: detect, drop + recreate. After this migration, `publishCollections()` force-includes every entity in the FTS push set — the manifest delta isn't enough on its own, because the FTS table was just emptied. The constant `FTS_RESET_FROM_BELOW = 2` exported from `db/migrations/worker.ts` lets the publish flow distinguish "the migration just ran" from "we were already current".

bm25 weights used by `worker/src/db/search.ts`: `title=10, tags=5, body=1, attachment=0.25` — kept identical to the local indexer (parity rule).

## Adding a new migration

Pseudo-code for a typical schema change. Replace the version numbers and identifiers as appropriate.

```ts
// packages/core/src/db/migrations/local.ts
export const LOCAL_MIGRATIONS: SyncMigration[] = [
  // ...existing migrations, untouched...
  {
    id: 4,
    description: "Short summary of the change.",
    up: (db) => {
      // Idempotent body. Read PRAGMAs to detect prior state if needed.
    },
  },
];
```

```ts
// packages/core/src/db/migrations/worker.ts
export const WORKER_MIGRATIONS: AsyncMigration[] = [
  // ...existing migrations, untouched...
  {
    id: 3,
    description: "Mirror of the local change for the published D1 schema.",
    up: async (db) => {
      // Async idempotent body. Use db.query() for PRAGMAs.
    },
  },
];
```

Then add corresponding sections to the **Local schema** / **Worker schema** lists above explaining the change.

## Resetting (development only)

To force every migration to re-run during development:

```sh
sqlite3 ~/.frozenink/collections/<name>/db/data.db "DELETE FROM metadata WHERE key='schema.version'"
# Migrations are idempotent so they're safe to re-apply.
```

For D1, drop the metadata row via `wrangler d1 execute --remote`. Production should never need this — the migration runner handles version transitions automatically.
