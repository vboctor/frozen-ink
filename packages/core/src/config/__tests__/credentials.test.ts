import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  loadCredentials,
  getNamedCredentials,
  saveNamedCredentials,
  removeNamedCredentials,
  listNamedCredentials,
  resolveCredentials,
} from "../credentials";
import {
  addCollection,
  getCollection,
  ensureInitialized,
} from "../context";

const TEST_DIR = join(import.meta.dir, ".test-credentials");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.FROZENINK_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

describe("loadCredentials", () => {
  it("returns empty object when file does not exist", () => {
    expect(loadCredentials()).toEqual({});
  });
});

describe("saveNamedCredentials / getNamedCredentials", () => {
  it("saves and retrieves a credential set", () => {
    saveNamedCredentials("my-github", { token: "ghp_abc123" });
    const creds = getNamedCredentials("my-github");
    expect(creds).toEqual({ token: "ghp_abc123" });
  });

  it("returns null for missing name", () => {
    expect(getNamedCredentials("nonexistent")).toBeNull();
  });

  it("updates an existing credential set", () => {
    saveNamedCredentials("my-github", { token: "old" });
    saveNamedCredentials("my-github", { token: "new" });
    expect(getNamedCredentials("my-github")).toEqual({ token: "new" });
  });

  it("preserves other entries when saving", () => {
    saveNamedCredentials("a", { token: "aaa" });
    saveNamedCredentials("b", { token: "bbb" });
    expect(getNamedCredentials("a")).toEqual({ token: "aaa" });
    expect(getNamedCredentials("b")).toEqual({ token: "bbb" });
  });
});

describe("removeNamedCredentials", () => {
  it("removes an entry", () => {
    saveNamedCredentials("my-github", { token: "ghp_abc123" });
    removeNamedCredentials("my-github");
    expect(getNamedCredentials("my-github")).toBeNull();
  });

  it("removes file when last entry is deleted", () => {
    saveNamedCredentials("only", { token: "x" });
    removeNamedCredentials("only");
    expect(existsSync(join(TEST_DIR, "credentials.yml"))).toBe(false);
  });

  it("preserves other entries", () => {
    saveNamedCredentials("a", { token: "aaa" });
    saveNamedCredentials("b", { token: "bbb" });
    removeNamedCredentials("a");
    expect(getNamedCredentials("a")).toBeNull();
    expect(getNamedCredentials("b")).toEqual({ token: "bbb" });
  });

  it("is a no-op for missing names", () => {
    saveNamedCredentials("a", { token: "aaa" });
    removeNamedCredentials("nonexistent");
    expect(getNamedCredentials("a")).toEqual({ token: "aaa" });
  });
});

describe("listNamedCredentials", () => {
  it("returns empty array when no credentials exist", () => {
    expect(listNamedCredentials()).toEqual([]);
  });

  it("returns all credential set names", () => {
    saveNamedCredentials("a", { token: "aaa" });
    saveNamedCredentials("b", { token: "bbb" });
    expect(listNamedCredentials().sort()).toEqual(["a", "b"]);
  });
});

describe("ensureInitialized creates sample credentials.yml", () => {
  it("creates a credentials.yml with documentation header", () => {
    ensureInitialized();
    const credPath = join(TEST_DIR, "credentials.yml");
    expect(existsSync(credPath)).toBe(true);
    const { readFileSync } = require("fs");
    const content = readFileSync(credPath, "utf-8");
    expect(content).toContain("# Frozen Ink");
    expect(content).toContain("my-github");
    // Should parse as empty (all entries are commented out)
    expect(loadCredentials()).toEqual({});
  });

  it("does not overwrite existing credentials.yml", () => {
    saveNamedCredentials("existing", { token: "keep-me" });
    ensureInitialized();
    expect(getNamedCredentials("existing")).toEqual({ token: "keep-me" });
  });
});

describe("collection schema with credential references", () => {
  it("accepts inline credentials object", () => {
    ensureInitialized();
    addCollection("test-inline", {
      crawler: "github",
      config: {},
      credentials: { token: "ghp_abc" },
    });
    const col = getCollection("test-inline");
    expect(col).not.toBeNull();
    expect(col!.credentials).toEqual({ token: "ghp_abc" });
  });

  it("accepts string credential reference", () => {
    ensureInitialized();
    addCollection("test-ref", {
      crawler: "github",
      config: {},
      credentials: "my-github",
    });
    const col = getCollection("test-ref");
    expect(col).not.toBeNull();
    expect(col!.credentials).toBe("my-github");
  });

  it("defaults credentials to empty object", () => {
    ensureInitialized();
    addCollection("test-default", {
      crawler: "github",
      config: {},
    });
    const col = getCollection("test-default");
    expect(col).not.toBeNull();
    expect(col!.credentials).toEqual({});
  });
});

describe("resolveCredentials", () => {
  it("passes through object credentials", () => {
    const creds = { token: "ghp_abc123" };
    expect(resolveCredentials(creds)).toBe(creds);
  });

  it("resolves a string reference to the named credential set", () => {
    saveNamedCredentials("my-github", { token: "ghp_abc123" });
    expect(resolveCredentials("my-github")).toEqual({ token: "ghp_abc123" });
  });

  it("throws for unknown string reference", () => {
    expect(() => resolveCredentials("nonexistent")).toThrow(
      /Unknown credential set: "nonexistent"/,
    );
  });
});
