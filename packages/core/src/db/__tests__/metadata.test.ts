import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  MetadataStore,
  getCollectionSyncState,
  updateCollectionSyncState,
  writeCollectionConfigMirror,
} from "../metadata";

const TEST_DIR = join(import.meta.dir, ".test-dbs-metadata");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("MetadataStore", () => {
  it("set then get returns the stored value", () => {
    const store = new MetadataStore(join(TEST_DIR, "meta.db"));
    store.set("cursor", "abc123");
    expect(store.get("cursor")).toBe("abc123");
    store.close();
  });

  it("get on missing key without default throws", () => {
    const store = new MetadataStore(join(TEST_DIR, "meta.db"));
    expect(() => store.get("missing")).toThrow('Metadata key not found: "missing"');
    store.close();
  });

  it("get on missing key with default returns the default", () => {
    const store = new MetadataStore(join(TEST_DIR, "meta.db"));
    expect(store.get("missing", "fallback")).toBe("fallback");
    store.close();
  });

  it("get on present key ignores the default", () => {
    const store = new MetadataStore(join(TEST_DIR, "meta.db"));
    store.set("key", "real-value");
    expect(store.get("key", "fallback")).toBe("real-value");
    store.close();
  });

  it("set overwrites an existing key", () => {
    const store = new MetadataStore(join(TEST_DIR, "meta.db"));
    store.set("version", "1");
    store.set("version", "2");
    expect(store.get("version")).toBe("2");
    store.close();
  });

  it("multiple distinct keys are independent", () => {
    const store = new MetadataStore(join(TEST_DIR, "meta.db"));
    store.set("a", "alpha");
    store.set("b", "beta");
    expect(store.get("a")).toBe("alpha");
    expect(store.get("b")).toBe("beta");
    store.close();
  });

  it("persists across instances with the same dbPath", () => {
    const dbPath = join(TEST_DIR, "meta.db");
    const store1 = new MetadataStore(dbPath);
    store1.set("sync_cursor", "xyz789");
    store1.close();

    const store2 = new MetadataStore(dbPath);
    expect(store2.get("sync_cursor")).toBe("xyz789");
    store2.close();
  });

  it("getOptional returns null when key is missing", () => {
    const store = new MetadataStore(join(TEST_DIR, "meta.db"));
    expect(store.getOptional("nope")).toBeNull();
    store.set("present", "value");
    expect(store.getOptional("present")).toBe("value");
    store.close();
  });

  it("delete removes a key", () => {
    const store = new MetadataStore(join(TEST_DIR, "meta.db"));
    store.set("disposable", "data");
    store.delete("disposable");
    expect(store.getOptional("disposable")).toBeNull();
    store.close();
  });
});

describe("MetadataStore sync state", () => {
  it("setSyncState then getSyncState roundtrips a full snapshot", () => {
    const store = new MetadataStore(join(TEST_DIR, "sync.db"));
    store.setSyncState({
      cursor: { page: 3, since: "2024-02-02" },
      lastAt: "2024-02-02 12:00:00",
      lastStatus: "completed",
      lastCreated: 5,
      lastUpdated: 2,
      lastDeleted: 1,
      lastErrors: [{ msg: "one" }],
    });

    const snapshot = store.getSyncState();
    expect(snapshot.cursor).toEqual({ page: 3, since: "2024-02-02" });
    expect(snapshot.lastAt).toBe("2024-02-02 12:00:00");
    expect(snapshot.lastStatus).toBe("completed");
    expect(snapshot.lastCreated).toBe(5);
    expect(snapshot.lastUpdated).toBe(2);
    expect(snapshot.lastDeleted).toBe(1);
    expect(snapshot.lastErrors).toEqual([{ msg: "one" }]);
    store.close();
  });

  it("setSyncState with null cursor clears the cursor key", () => {
    const store = new MetadataStore(join(TEST_DIR, "sync.db"));
    store.setSyncState({ cursor: { page: 1 } });
    expect(store.getSyncState().cursor).toEqual({ page: 1 });
    store.setSyncState({ cursor: null });
    expect(store.getSyncState().cursor).toBeUndefined();
    store.close();
  });

  it("setSyncState with empty errors array clears the errors key", () => {
    const store = new MetadataStore(join(TEST_DIR, "sync.db"));
    store.setSyncState({ lastErrors: [{ m: "x" }] });
    expect(store.getSyncState().lastErrors).toEqual([{ m: "x" }]);
    store.setSyncState({ lastErrors: [] });
    expect(store.getSyncState().lastErrors).toBeUndefined();
    store.close();
  });

  it("setSyncState only touches supplied fields", () => {
    const store = new MetadataStore(join(TEST_DIR, "sync.db"));
    store.setSyncState({ lastStatus: "running", lastAt: "t1" });
    store.setSyncState({ lastStatus: "completed" });
    const snapshot = store.getSyncState();
    expect(snapshot.lastStatus).toBe("completed");
    expect(snapshot.lastAt).toBe("t1");
    store.close();
  });

  it("getCollectionSyncState returns empty snapshot when DB does not exist", () => {
    const missing = join(TEST_DIR, "nope", "nope.db");
    expect(getCollectionSyncState(missing)).toEqual({});
  });

  it("updateCollectionSyncState creates DB and is readable via getCollectionSyncState", () => {
    const dbPath = join(TEST_DIR, "helpers.db");
    updateCollectionSyncState(dbPath, { lastAt: "t", lastCreated: 7 });
    const snap = getCollectionSyncState(dbPath);
    expect(snap.lastAt).toBe("t");
    expect(snap.lastCreated).toBe(7);
  });

  it("writeCollectionConfigMirror stores and clears title/description", () => {
    const dbPath = join(TEST_DIR, "mirror.db");
    writeCollectionConfigMirror(dbPath, { title: "T", description: "D" });
    const store = new MetadataStore(dbPath);
    expect(store.getCollectionTitle()).toBe("T");
    expect(store.getCollectionDescription()).toBe("D");
    store.close();

    writeCollectionConfigMirror(dbPath, { title: null, description: null });
    const store2 = new MetadataStore(dbPath);
    expect(store2.getCollectionTitle()).toBeNull();
    expect(store2.getCollectionDescription()).toBeNull();
    store2.close();
  });
});
