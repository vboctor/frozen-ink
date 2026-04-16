import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import {
  getCollectionDb,
  entities,
  addCollection,
  ThemeEngine,
  SyncEngine,
  LocalStorageBackend,
  computeEntityHash,
  getCollectionDbPath,
  getFrozenInkHome,
} from "@frozenink/core";
import type {
  Crawler,
  SyncCursor,
  SyncResult,
  Theme,
  ThemeRenderContext,
  EntityData,
} from "@frozenink/core";
import { generateCollection } from "../commands/generate";

const TEST_DIR = join(import.meta.dir, ".test-generate-hash");

function mockTheme(renderBody: (ctx: ThemeRenderContext) => string): Theme {
  return {
    crawlerType: "mock",
    render(ctx) { return renderBody(ctx); },
    getFilePath(ctx) { return `${ctx.entity.entityType}/${ctx.entity.externalId}.md`; },
  };
}

function mockCrawler(pages: SyncResult[]): Crawler {
  let i = 0;
  return {
    metadata: {
      type: "mock",
      displayName: "Mock",
      description: "",
      configSchema: {},
      credentialFields: [],
    },
    async initialize() {},
    async sync(_c: SyncCursor | null) { return pages[i++]; },
    async validateCredentials() { return true; },
    async dispose() {},
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.FROZENINK_HOME = TEST_DIR;
  mkdirSync(join(TEST_DIR, "collections", "gen-test"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

describe("generateCollection — content hash maintenance", () => {
  it("recomputes content_hash for every entity so stored hash matches current row state", async () => {
    addCollection("gen-test", { crawler: "mock", config: {}, credentials: {} });

    // Seed the DB via a real sync so entities + initial hashes exist
    const themeEngine = new ThemeEngine();
    themeEngine.register(mockTheme((ctx) => `# ${ctx.entity.title}\n\nv1`));
    const storage = new LocalStorageBackend(join(TEST_DIR, "collections", "gen-test"));

    const engine = new SyncEngine({
      crawler: mockCrawler([{
        entities: [
          { externalId: "a", entityType: "doc", title: "Original A", data: { body: "x" } },
          { externalId: "b", entityType: "doc", title: "Original B", data: { body: "y" } },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      }]),
      dbPath: getCollectionDbPath("gen-test"),
      collectionName: "gen-test",
      themeEngine,
      storage,
      markdownBasePath: "content",
    });
    await engine.run();

    // Simulate stale hashes by corrupting them directly
    const dbPath = getCollectionDbPath("gen-test");
    const colDb = getCollectionDb(dbPath);
    colDb.update(entities).set({ contentHash: "stale" }).run();

    // Run generate with a theme whose getTitle() returns something different so titles
    // (and therefore hashes) change during regeneration.
    const renameTheme = new ThemeEngine();
    renameTheme.register({
      crawlerType: "mock",
      render(ctx) { return `# ${ctx.entity.title}\n\nv2`; },
      getFilePath(ctx) { return `${ctx.entity.entityType}/${ctx.entity.externalId}.md`; },
      getTitle(ctx) { return `Renamed ${ctx.entity.externalId}`; },
    });

    const col = {
      name: "gen-test",
      crawler: "mock",
      enabled: true,
      version: "1.0",
      config: {},
      credentials: {},
    };
    await generateCollection(col as any, getFrozenInkHome(), renameTheme);

    // Every row's stored hash should match what computeEntityHash produces now
    const rows = colDb.select().from(entities).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.contentHash).not.toBe("stale");
      const expected = computeEntityHash({
        entityType: row.entityType,
        title: row.title,
        folder: row.folder ?? null,
        slug: row.slug ?? null,
        data: row.data as EntityData,
      });
      expect(row.contentHash).toBe(expected);
    }
  });

  it("leaves hashes untouched when nothing about the rows changed", async () => {
    addCollection("gen-test", { crawler: "mock", config: {}, credentials: {} });

    const themeEngine = new ThemeEngine();
    themeEngine.register(mockTheme((ctx) => `# ${ctx.entity.title}\n\nbody`));
    const storage = new LocalStorageBackend(join(TEST_DIR, "collections", "gen-test"));

    const engine = new SyncEngine({
      crawler: mockCrawler([{
        entities: [{ externalId: "stable", entityType: "doc", title: "Stable", data: { body: "s" } }],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      }]),
      dbPath: getCollectionDbPath("gen-test"),
      collectionName: "gen-test",
      themeEngine,
      storage,
      markdownBasePath: "content",
    });
    await engine.run();

    const dbPath = getCollectionDbPath("gen-test");
    const colDb = getCollectionDb(dbPath);
    const [before] = colDb.select().from(entities).where(eq(entities.externalId, "stable")).all();

    const col = {
      name: "gen-test",
      crawler: "mock",
      enabled: true,
      version: "1.0",
      config: {},
      credentials: {},
    };
    await generateCollection(col as any, getFrozenInkHome(), themeEngine);

    const [after] = colDb.select().from(entities).where(eq(entities.externalId, "stable")).all();
    expect(after.contentHash).toBe(before.contentHash);
  });
});
