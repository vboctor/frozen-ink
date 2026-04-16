import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { MetadataStore } from "../metadata";

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
});
