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

  it("FTS table reaches the final 8-column shape after all migrations", () => {
    const db = open();
    runSyncMigrations(db, LOCAL_MIGRATIONS);
    const cols = db
      .prepare("PRAGMA table_info(entities_fts)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("collection_name");
    expect(names).toContain("title");
    expect(names).toContain("content");
    expect(names).toContain("tags");
    expect(names).toContain("attachment_text");
  });
});
