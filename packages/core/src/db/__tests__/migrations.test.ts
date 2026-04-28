import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  LOCAL_MIGRATIONS,
  runSyncMigrations,
  SCHEMA_VERSION_KEY,
  _clearMigrationCacheForTests,
} from "../migrations";

function open(): Database {
  return new Database(":memory:");
}

describe("runSyncMigrations", () => {
  beforeEach(() => {
    _clearMigrationCacheForTests();
  });

  it("brings a fresh DB up to the latest version and records it", () => {
    const db = open();
    const result = runSyncMigrations(db, LOCAL_MIGRATIONS);
    expect(result.current).toBe(LOCAL_MIGRATIONS[LOCAL_MIGRATIONS.length - 1].id);
    expect(result.applied).toEqual(LOCAL_MIGRATIONS.map((m) => m.id));
    const row = db
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(SCHEMA_VERSION_KEY) as { value: string };
    expect(row.value).toBe(String(LOCAL_MIGRATIONS[LOCAL_MIGRATIONS.length - 1].id));
  });

  it("is a no-op when the DB is already at the latest version", () => {
    const db = open();
    runSyncMigrations(db, LOCAL_MIGRATIONS);
    const second = runSyncMigrations(db, LOCAL_MIGRATIONS);
    expect(second.applied).toEqual([]);
  });

  it("re-verifies even when the same cacheKey is reused (no in-process cache)", () => {
    // Each call always hits the underlying DB. The cacheKey parameter is
    // kept for API symmetry but is intentionally ignored — caching across
    // file recreations is a correctness hazard.
    const db1 = open();
    runSyncMigrations(db1, LOCAL_MIGRATIONS, "shared");

    const db2 = open();
    const result = runSyncMigrations(db2, LOCAL_MIGRATIONS, "shared");
    expect(result.applied).toEqual(LOCAL_MIGRATIONS.map((m) => m.id));
    // db2 was a fresh empty DB; the runner created tables on it.
    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(tables.find((t) => t.name === "metadata")).toBeDefined();
    expect(tables.find((t) => t.name === "entities")).toBeDefined();
  });

  it("only applies migrations newer than the recorded version", () => {
    const db = open();
    // Pretend we're already at v1: create the metadata table and stamp it.
    db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run(
      SCHEMA_VERSION_KEY,
      "1",
    );
    LOCAL_MIGRATIONS[0].up(db); // simulate the v1 effects

    const result = runSyncMigrations(db, LOCAL_MIGRATIONS);
    expect(result.current).toBe(LOCAL_MIGRATIONS[LOCAL_MIGRATIONS.length - 1].id);
    expect(result.applied).toEqual(LOCAL_MIGRATIONS.slice(1).map((m) => m.id));
  });

  it("FTS table reaches the final 7-column shape after all migrations", () => {
    const db = open();
    runSyncMigrations(db, LOCAL_MIGRATIONS);
    const cols = db
      .prepare("PRAGMA table_info(entities_fts)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    // collection_name was dropped in v4 — never queried, redundant since
    // each collection has its own DB file.
    expect(names).not.toContain("collection_name");
    expect(names).toContain("entity_id");
    expect(names).toContain("title");
    expect(names).toContain("content");
    expect(names).toContain("tags");
    expect(names).toContain("attachment_text");
  });

  it("entities table loses AUTOINCREMENT after v4 (matches worker shape)", () => {
    const db = open();
    runSyncMigrations(db, LOCAL_MIGRATIONS);
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='entities'")
      .get() as { sql: string };
    expect(row.sql).not.toContain("AUTOINCREMENT");
    expect(row.sql).toContain("INTEGER PRIMARY KEY");
  });

  it("v4 preserves entity row data (id, columns) when rebuilding the table", () => {
    const db = open();
    // Run v1+v2+v3 (skip v4 by simulating an at-v3 DB), insert real data, then run v4.
    db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    LOCAL_MIGRATIONS.slice(0, 3).forEach((m) => m.up(db));
    db.prepare("INSERT INTO metadata (key, value) VALUES ('schema.version', '3')").run();

    db.prepare(
      "INSERT INTO entities (external_id, entity_type, title, data) VALUES (?, ?, ?, ?)",
    ).run("foo-1", "note", "Hello", '{"source":{}}');
    db.prepare(
      "INSERT INTO entities (external_id, entity_type, title, data) VALUES (?, ?, ?, ?)",
    ).run("foo-2", "note", "World", '{"source":{}}');

    const before = db.prepare("SELECT id, external_id, title FROM entities ORDER BY id").all();

    runSyncMigrations(db, LOCAL_MIGRATIONS);

    const after = db.prepare("SELECT id, external_id, title FROM entities ORDER BY id").all();
    expect(after).toEqual(before);
    // And the indexes survive the rebuild.
    const idxs = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entities'")
      .all() as Array<{ name: string }>;
    const idxNames = idxs.map((i) => i.name);
    expect(idxNames).toContain("idx_entities_external");
    expect(idxNames).toContain("idx_entities_folder");
  });
});
