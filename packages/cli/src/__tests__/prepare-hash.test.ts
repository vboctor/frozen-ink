import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
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
import { prepareCollection } from "../commands/prepare";

const TEST_DIR = join(import.meta.dir, ".test-prepare-hash");

function mockTheme(): Theme {
  return {
    crawlerType: "mock",
    render(ctx: ThemeRenderContext) { return `# ${ctx.entity.title}\n\nbody`; },
    getFilePath(ctx: ThemeRenderContext) { return `${ctx.entity.entityType}/${ctx.entity.externalId}.md`; },
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

async function seedCollection() {
  addCollection("prep-test", { crawler: "mock", config: {}, credentials: {} });

  const themeEngine = new ThemeEngine();
  themeEngine.register(mockTheme());
  const storage = new LocalStorageBackend(join(TEST_DIR, "collections", "prep-test"));

  const engine = new SyncEngine({
    crawler: mockCrawler([{
      entities: [
        { externalId: "e1", entityType: "doc", title: "E1", data: { body: "1" } },
        { externalId: "e2", entityType: "doc", title: "E2", data: { body: "2" } },
      ],
      nextCursor: null,
      hasMore: false,
      deletedExternalIds: [],
    }]),
    dbPath: getCollectionDbPath("prep-test"),
    collectionName: "prep-test",
    themeEngine,
    storage,
    markdownBasePath: "content",
  });
  await engine.run();
  return { themeEngine };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.FROZENINK_HOME = TEST_DIR;
  mkdirSync(join(TEST_DIR, "collections", "prep-test"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

describe("prepareCollection — content hash verification", () => {
  it("detects a stale content_hash and warns without auto-regenerating", async () => {
    const { themeEngine } = await seedCollection();

    const dbPath = getCollectionDbPath("prep-test");
    const colDb = getCollectionDb(dbPath);

    // Corrupt the stored hashes so they no longer match row state. Title + markdown
    // are still fresh, so only the hash check should flag this collection.
    colDb.update(entities).set({ contentHash: "deadbeef" }).run();

    const logs: string[] = [];
    const col = {
      name: "prep-test",
      crawler: "mock",
      enabled: true,
      version: "1.0",
      config: {},
      credentials: {},
    };
    await prepareCollection(col as any, getFrozenInkHome(), themeEngine, (m) => logs.push(m));

    // Prepare logged the hash mismatch reason and the suggested command
    const warnLog = logs.find((l) => l.includes("outdated"));
    expect(warnLog).toBeDefined();
    expect(warnLog).toContain("hash");
    expect(warnLog).toContain("fink generate");

    // Prepare must NOT auto-fix hashes — the user runs `fink generate` explicitly.
    // Every row should still have the corrupted hash we wrote above.
    const rows = colDb.select().from(entities).all();
    for (const row of rows) {
      expect(row.contentHash).toBe("deadbeef");
      // Sanity: the expected hash is different, confirming we did detect staleness.
      const expected = computeEntityHash({
        entityType: row.entityType,
        title: row.title,
        folder: row.folder ?? null,
        slug: row.slug ?? null,
        data: row.data as EntityData,
      });
      expect(expected).not.toBe("deadbeef");
    }
  });

  it("does not regenerate when title, markdown, and hash are all in sync", async () => {
    const { themeEngine } = await seedCollection();

    const logs: string[] = [];
    const col = {
      name: "prep-test",
      crawler: "mock",
      enabled: true,
      version: "1.0",
      config: {},
      credentials: {},
    };
    await prepareCollection(col as any, getFrozenInkHome(), themeEngine, (m) => logs.push(m));

    expect(logs.find((l) => l.includes("outdated"))).toBeUndefined();
  });
});
