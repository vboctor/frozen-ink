import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { migrateSyncStateToMetadataDb } from "../context";
import { MetadataStore, getCollectionSyncState } from "../../db/metadata";

const TEST_DIR = join(import.meta.dir, ".test-migrate-sync");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.FROZENINK_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

function seedCollection(name: string, entry: Record<string, unknown>): string {
  const colDir = join(TEST_DIR, "collections", name);
  mkdirSync(colDir, { recursive: true });
  const configPath = join(colDir, `${name}.yml`);
  writeFileSync(configPath, yaml.dump(entry), "utf-8");
  return configPath;
}

describe("migrateSyncStateToMetadataDb", () => {
  it("moves legacy sync fields from YAML into metadata DB and strips them", () => {
    const configPath = seedCollection("legacy", {
      crawler: "mock",
      title: "Legacy Title",
      description: "Legacy Description",
      version: "2.0",
      config: {},
      credentials: {},
      syncCursor: { page: 4, since: "2024-03-03" },
      lastSyncAt: "2024-03-03 15:30:00",
      lastSyncStatus: "completed",
      lastSyncCreated: 7,
      lastSyncUpdated: 2,
      lastSyncDeleted: 1,
      lastSyncErrors: [{ msg: "bad" }],
    });

    migrateSyncStateToMetadataDb();

    // DB metadata now holds the sync state
    const dbPath = join(TEST_DIR, "collections", "legacy", "db", "data.db");
    const snap = getCollectionSyncState(dbPath);
    expect(snap.cursor).toEqual({ page: 4, since: "2024-03-03" });
    expect(snap.lastAt).toBe("2024-03-03 15:30:00");
    expect(snap.lastStatus).toBe("completed");
    expect(snap.lastCreated).toBe(7);
    expect(snap.lastUpdated).toBe(2);
    expect(snap.lastDeleted).toBe(1);
    expect(snap.lastErrors).toEqual([{ msg: "bad" }]);

    // Title/description mirrored into DB
    const store = new MetadataStore(dbPath);
    expect(store.getCollectionTitle()).toBe("Legacy Title");
    expect(store.getCollectionDescription()).toBe("Legacy Description");
    expect(store.getCollectionVersion()).toBe("2.0");
    store.close();

    // YAML no longer contains legacy fields
    const rewritten = yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    expect(rewritten.syncCursor).toBeUndefined();
    expect(rewritten.lastSyncAt).toBeUndefined();
    expect(rewritten.lastSyncStatus).toBeUndefined();
    expect(rewritten.lastSyncCreated).toBeUndefined();
    expect(rewritten.lastSyncUpdated).toBeUndefined();
    expect(rewritten.lastSyncDeleted).toBeUndefined();
    expect(rewritten.lastSyncErrors).toBeUndefined();
    // User config survives
    expect(rewritten.crawler).toBe("mock");
    expect(rewritten.title).toBe("Legacy Title");
    expect(rewritten.description).toBe("Legacy Description");
  });

  it("is a no-op when no legacy fields are present", () => {
    const configPath = seedCollection("clean", {
      crawler: "mock",
      title: "Clean",
      config: {},
      credentials: {},
    });
    const before = readFileSync(configPath, "utf-8");

    migrateSyncStateToMetadataDb();

    // YAML is unchanged
    expect(readFileSync(configPath, "utf-8")).toBe(before);

    // DB was not created (no work to do)
    const dbPath = join(TEST_DIR, "collections", "clean", "db", "data.db");
    expect(existsSync(dbPath)).toBe(false);
  });

  it("migrates only the collections that still have legacy fields", () => {
    seedCollection("stale", {
      crawler: "mock",
      config: {},
      credentials: {},
      lastSyncAt: "2024-01-01 00:00:00",
      lastSyncStatus: "completed",
    });
    const cleanPath = seedCollection("pristine", {
      crawler: "mock",
      config: {},
      credentials: {},
    });
    const pristineBefore = readFileSync(cleanPath, "utf-8");

    migrateSyncStateToMetadataDb();

    const staleDb = join(TEST_DIR, "collections", "stale", "db", "data.db");
    expect(getCollectionSyncState(staleDb).lastAt).toBe("2024-01-01 00:00:00");

    // The other collection is untouched
    expect(readFileSync(cleanPath, "utf-8")).toBe(pristineBefore);
    expect(existsSync(join(TEST_DIR, "collections", "pristine", "db", "data.db"))).toBe(false);
  });

  it("seeds title/description mirror for collections with an existing DB but no legacy fields", () => {
    const configPath = seedCollection("pre-synced", {
      crawler: "mock",
      title: "Pre-synced",
      description: "Already migrated earlier",
      config: {},
      credentials: {},
    });
    const before = readFileSync(configPath, "utf-8");

    // Simulate an already-existing DB (e.g. the sync engine ran once before)
    const dbPath = join(TEST_DIR, "collections", "pre-synced", "db", "data.db");
    new MetadataStore(dbPath).close();

    migrateSyncStateToMetadataDb();

    // YAML is unchanged
    expect(readFileSync(configPath, "utf-8")).toBe(before);

    // DB has the mirror keys populated
    const store = new MetadataStore(dbPath);
    try {
      expect(store.getCollectionTitle()).toBe("Pre-synced");
      expect(store.getCollectionDescription()).toBe("Already migrated earlier");
    } finally {
      store.close();
    }
  });

  it("is idempotent — running a second time has no additional effect", () => {
    const configPath = seedCollection("idem", {
      crawler: "mock",
      config: {},
      credentials: {},
      lastSyncAt: "2024-04-04 01:01:01",
      lastSyncStatus: "completed",
      lastSyncCreated: 3,
    });

    migrateSyncStateToMetadataDb();
    const afterFirst = readFileSync(configPath, "utf-8");
    migrateSyncStateToMetadataDb();
    const afterSecond = readFileSync(configPath, "utf-8");

    expect(afterSecond).toBe(afterFirst);
    const dbPath = join(TEST_DIR, "collections", "idem", "db", "data.db");
    const snap = getCollectionSyncState(dbPath);
    expect(snap.lastStatus).toBe("completed");
    expect(snap.lastCreated).toBe(3);
  });
});
