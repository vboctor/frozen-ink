import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { LocalStorageBackend } from "../local";

const TEST_DIR = join(import.meta.dir, ".test-storage");

let storage: LocalStorageBackend;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  storage = new LocalStorageBackend(TEST_DIR);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("LocalStorageBackend", () => {
  it("writes and reads a file", async () => {
    await storage.write("test.md", "hello world");
    const content = await storage.read("test.md");
    expect(content).toBe("hello world");
  });

  it("creates nested directories on write", async () => {
    await storage.write("a/b/c/deep.txt", "deep content");
    const content = await storage.read("a/b/c/deep.txt");
    expect(content).toBe("deep content");
  });

  it("overwrites existing file on write", async () => {
    await storage.write("file.txt", "original");
    await storage.write("file.txt", "updated");
    const content = await storage.read("file.txt");
    expect(content).toBe("updated");
  });

  it("deletes a file", async () => {
    await storage.write("to-delete.txt", "gone soon");
    expect(await storage.exists("to-delete.txt")).toBe(true);
    await storage.delete("to-delete.txt");
    expect(await storage.exists("to-delete.txt")).toBe(false);
  });

  it("returns true for exists when file exists", async () => {
    await storage.write("exists.txt", "here");
    expect(await storage.exists("exists.txt")).toBe(true);
  });

  it("returns false for exists when file does not exist", async () => {
    expect(await storage.exists("nope.txt")).toBe(false);
  });

  it("throws when reading a non-existent file", async () => {
    expect(storage.read("missing.txt")).rejects.toThrow();
  });

  it("throws when deleting a non-existent file", async () => {
    expect(storage.delete("missing.txt")).rejects.toThrow();
  });

  it("writes and reads Buffer content", async () => {
    const buf = Buffer.from("binary data");
    await storage.write("binary.bin", buf);
    const content = await storage.read("binary.bin");
    expect(content).toBe("binary data");
  });

  it("lists files under a prefix recursively", async () => {
    await storage.write("docs/readme.md", "readme");
    await storage.write("docs/guide/intro.md", "intro");
    await storage.write("docs/guide/advanced.md", "advanced");
    await storage.write("other/file.txt", "other");

    const files = await storage.list("docs");
    expect(files.sort()).toEqual([
      "docs/guide/advanced.md",
      "docs/guide/intro.md",
      "docs/readme.md",
    ]);
  });

  it("returns empty array when listing non-existent prefix", async () => {
    const files = await storage.list("nonexistent");
    expect(files).toEqual([]);
  });

  it("stat returns mtime and size for an existing file", async () => {
    const before = Date.now();
    await storage.write("stat-test.txt", "hello");
    const after = Date.now();
    const s = await storage.stat("stat-test.txt");
    expect(s).not.toBeNull();
    expect(s!.size).toBe(5);
    expect(s!.mtimeMs).toBeGreaterThanOrEqual(before);
    expect(s!.mtimeMs).toBeLessThanOrEqual(after + 10);
  });

  it("stat returns null for a non-existent file", async () => {
    const s = await storage.stat("does-not-exist.txt");
    expect(s).toBeNull();
  });

  it("stat reflects updated size after overwrite", async () => {
    await storage.write("grow.txt", "short");
    const s1 = await storage.stat("grow.txt");
    await storage.write("grow.txt", "much longer content here");
    const s2 = await storage.stat("grow.txt");
    expect(s2!.size).toBeGreaterThan(s1!.size);
  });
});
