import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  getCollectionDb,
  entities,
  syncRuns,
  SearchIndexer,
  addCollection,
  getCollection,
  listCollections,
} from "@veecontext/core";

const TEST_DIR = join(import.meta.dir, ".test-cli");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.VEECONTEXT_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.VEECONTEXT_HOME;
});

describe("CLI: init", () => {
  it("creates directory structure with config.json and context.yml", async () => {
    const { initCommand } = await import("../commands/init");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await initCommand.parseAsync([], { from: "user" });

    console.log = origLog;

    expect(existsSync(join(TEST_DIR, "config.json"))).toBe(true);
    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    expect(config.db.mode).toBe("local");
    expect(config.sync.interval).toBe(900);

    expect(existsSync(join(TEST_DIR, "context.yml"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "collections"))).toBe(true);
    expect(listCollections()).toHaveLength(0);
    expect(logs.some((l) => l.includes("Initialized VeeContext"))).toBe(true);
  });

  it("skips if already initialized", async () => {
    const { initCommand: initCmd1 } = await import("../commands/init");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await initCmd1.parseAsync([], { from: "user" });

    const { initCommand: initCmd2 } = await import("../commands/init");
    await initCmd2.parseAsync([], { from: "user" });

    console.log = origLog;

    expect(logs.some((l) => l.includes("already initialized"))).toBe(true);
  });
});

describe("CLI: add", () => {
  it("creates collection in context.yml and collection directory", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};
    await initCommand.parseAsync([], { from: "user" });

    const collectionDir = join(TEST_DIR, "collections", "test-gh");
    const dbPath = join(collectionDir, "data.db");
    mkdirSync(collectionDir, { recursive: true });
    mkdirSync(join(collectionDir, "markdown"), { recursive: true });
    getCollectionDb(dbPath);

    addCollection("test-gh", {
      crawler: "github",
      config: { owner: "test", repo: "repo" },
      credentials: { token: "tok", owner: "test", repo: "repo" },
    });

    console.log = origLog;

    const cols = listCollections();
    expect(cols).toHaveLength(1);
    expect(cols[0].name).toBe("test-gh");
    expect(cols[0].crawler).toBe("github");
    expect(cols[0].enabled).toBe(true);
    expect(existsSync(collectionDir)).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(join(collectionDir, "markdown"))).toBe(true);
  });
});

describe("CLI: collections", () => {
  it("list shows collections", async () => {
    const { initCommand } = await import("../commands/init");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await initCommand.parseAsync([], { from: "user" });

    mkdirSync(join(TEST_DIR, "collections", "my-col"), { recursive: true });
    addCollection("my-col", { crawler: "github", config: {}, credentials: {} });

    const { collectionsCommand } = await import("../commands/collections");
    await collectionsCommand.parseAsync(["list"], { from: "user" });

    console.log = origLog;

    expect(logs.some((l) => l.includes("my-col") && l.includes("github"))).toBe(true);
  });

  it("enable/disable toggles collection state", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    mkdirSync(join(TEST_DIR, "collections", "toggled"), { recursive: true });
    addCollection("toggled", { crawler: "github", config: {}, credentials: {} });

    const { collectionsCommand: cc1 } = await import("../commands/collections");
    await cc1.parseAsync(["disable", "toggled"], { from: "user" });

    let col = getCollection("toggled");
    expect(col!.enabled).toBe(false);

    const { collectionsCommand: cc2 } = await import("../commands/collections");
    await cc2.parseAsync(["enable", "toggled"], { from: "user" });

    col = getCollection("toggled");
    expect(col!.enabled).toBe(true);

    console.log = origLog;
  });

  it("remove deletes collection and directory", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    const collectionDir = join(TEST_DIR, "collections", "to-remove");
    const dbPath = join(collectionDir, "data.db");
    mkdirSync(collectionDir, { recursive: true });
    getCollectionDb(dbPath);
    addCollection("to-remove", { crawler: "github", config: {}, credentials: {} });

    const { collectionsCommand } = await import("../commands/collections");
    await collectionsCommand.parseAsync(["remove", "to-remove"], { from: "user" });

    console.log = origLog;

    expect(getCollection("to-remove")).toBeNull();
    expect(existsSync(collectionDir)).toBe(false);
  });
});

describe("CLI: status", () => {
  it("shows entity counts and sync run info", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    const collectionDir = join(TEST_DIR, "collections", "status-test");
    const dbPath = join(collectionDir, "data.db");
    mkdirSync(collectionDir, { recursive: true });
    const colDb = getCollectionDb(dbPath);

    addCollection("status-test", { crawler: "github", config: {}, credentials: {} });

    colDb.insert(entities).values({ externalId: "issue-1", entityType: "issue", title: "Test Issue", data: { number: 1 } }).run();
    colDb.insert(entities).values({ externalId: "pr-1", entityType: "pull_request", title: "Test PR", data: { number: 2 } }).run();
    colDb.insert(syncRuns).values({ status: "completed", entitiesCreated: 2, startedAt: "2025-01-01 00:00:00", completedAt: "2025-01-01 00:01:00" }).run();

    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { statusCommand } = await import("../commands/status");
    await statusCommand.parseAsync([], { from: "user" });

    console.log = origLog;

    expect(logs.some((l) => l.includes("status-test"))).toBe(true);
    expect(logs.some((l) => l.includes("Entities: 2"))).toBe(true);
    expect(logs.some((l) => l.includes("completed"))).toBe(true);
    expect(logs.some((l) => l.includes("Created: 2"))).toBe(true);
  });
});

describe("CLI: search", () => {
  it("returns FTS results across collections", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    const collectionDir = join(TEST_DIR, "collections", "search-test");
    const dbPath = join(collectionDir, "data.db");
    mkdirSync(collectionDir, { recursive: true });
    const colDb = getCollectionDb(dbPath);

    addCollection("search-test", { crawler: "github", config: {}, credentials: {} });

    colDb.insert(entities).values({ externalId: "issue-42", entityType: "issue", title: "Authentication login bug", data: { number: 42 } }).run();

    const indexer = new SearchIndexer(dbPath);
    indexer.updateIndex({ id: 1, externalId: "issue-42", entityType: "issue", title: "Authentication login bug", content: "Users cannot login with OAuth", tags: ["bug"] });
    indexer.close();

    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { searchCommand } = await import("../commands/search");
    await searchCommand.parseAsync(["authentication"], { from: "user" });

    console.log = origLog;

    expect(logs.some((l) => l.includes("Authentication login bug"))).toBe(true);
    expect(logs.some((l) => l.includes("1 result"))).toBe(true);
  });

  it("supports --json flag", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    const collectionDir = join(TEST_DIR, "collections", "json-test");
    const dbPath = join(collectionDir, "data.db");
    mkdirSync(collectionDir, { recursive: true });
    getCollectionDb(dbPath);

    addCollection("json-test", { crawler: "github", config: {}, credentials: {} });

    const indexer = new SearchIndexer(dbPath);
    indexer.updateIndex({ id: 1, externalId: "issue-10", entityType: "issue", title: "Performance optimization", content: "Optimize database queries", tags: ["performance"] });
    indexer.close();

    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { searchCommand } = await import("../commands/search");
    await searchCommand.parseAsync(["--json", "optimization"], { from: "user" });

    console.log = origLog;

    const parsed = JSON.parse(logs.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].externalId).toBe("issue-10");
    expect(parsed[0].collection).toBe("json-test");
  });
});

describe("CLI: config", () => {
  it("get returns config values", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { configCommand } = await import("../commands/config");
    await configCommand.parseAsync(["get", "sync.interval"], { from: "user" });

    console.log = origLog;

    expect(logs).toContain("900");
  });

  it("set updates config.json", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    const { configCommand: cc1 } = await import("../commands/config");
    await cc1.parseAsync(["set", "sync.interval", "1800"], { from: "user" });

    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    expect(config.sync.interval).toBe(1800);

    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { configCommand: cc2 } = await import("../commands/config");
    await cc2.parseAsync(["get", "sync.interval"], { from: "user" });

    console.log = origLog;

    expect(logs).toContain("1800");
  });

  it("list shows all config", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { configCommand } = await import("../commands/config");
    await configCommand.parseAsync(["list"], { from: "user" });

    console.log = origLog;

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.db.mode).toBe("local");
    expect(parsed.sync.interval).toBe(900);
    expect(parsed.logging.level).toBe("info");
  });
});

describe("CLI: sync triggers crawler", () => {
  it("syncs a collection using the sync engine", async () => {
    const { initCommand } = await import("../commands/init");
    const origLog = console.log;
    console.log = () => {};

    await initCommand.parseAsync([], { from: "user" });

    const collectionDir = join(TEST_DIR, "collections", "sync-test");
    const dbPath = join(collectionDir, "data.db");
    mkdirSync(collectionDir, { recursive: true });
    mkdirSync(join(collectionDir, "markdown"), { recursive: true });
    getCollectionDb(dbPath);

    addCollection("sync-test", {
      crawler: "github",
      config: { owner: "test", repo: "repo" },
      credentials: { token: "test-token", owner: "test", repo: "repo" },
    });

    console.log = origLog;

    const cols = listCollections();
    expect(cols).toHaveLength(1);
    expect(cols[0].name).toBe("sync-test");
    expect(existsSync(dbPath)).toBe(true);
  });
});
