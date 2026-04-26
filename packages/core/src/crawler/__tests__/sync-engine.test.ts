import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { SyncEngine, extractWikilinks } from "../sync-engine";
import { getCollectionDb } from "../../db/client";
import { entities } from "../../db/collection-schema";
import type { EntityData } from "../../db/collection-schema";
import { MetadataStore, getCollectionSyncState } from "../../db/metadata";
import { getCollection, addCollection } from "../../config/context";
import { ThemeEngine } from "../../theme/engine";
import { LocalStorageBackend } from "../../storage/local";
import type { Crawler, SyncCursor, SyncResult } from "../interface";
import type { Theme, ThemeRenderContext } from "../../theme/interface";

const TEST_DIR = join(import.meta.dir, ".test-sync");

function createMockTheme(): Theme {
  return {
    crawlerType: "mock",
    render(ctx: ThemeRenderContext): string {
      return `# ${ctx.entity.title}\n\n${JSON.stringify(ctx.entity.data)}`;
    },
    getFilePath(ctx: ThemeRenderContext): string {
      return `${ctx.entity.entityType}/${ctx.entity.externalId}.md`;
    },
  };
}

function createMockCrawler(pages: SyncResult[], crawlerType = "mock"): Crawler {
  let callIndex = 0;
  return {
    metadata: {
      type: crawlerType,
      displayName: "Mock Crawler",
      description: "A mock crawler for testing",
      configSchema: {},
      credentialFields: [],
    },
    async initialize() {},
    async sync(_cursor: SyncCursor | null): Promise<SyncResult> {
      const result = pages[callIndex];
      callIndex++;
      return result;
    },
    async validateCredentials() {
      return true;
    },
    async dispose() {},
  };
}

let themeEngine: ThemeEngine;
let storage: LocalStorageBackend;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.FROZENINK_HOME = TEST_DIR;
  mkdirSync(join(TEST_DIR, "collections", "test"), { recursive: true });
  addCollection("test", { crawler: "mock", config: {}, credentials: {} });
  themeEngine = new ThemeEngine();
  themeEngine.register(createMockTheme());
  storage = new LocalStorageBackend(join(TEST_DIR, "storage"));
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

describe("SyncEngine", () => {
  it("loops crawler.sync() until hasMore is false", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "item-1",
            entityType: "issue",
            title: "First",
            data: { body: "page1" },
          },
        ],
        nextCursor: { page: 2 },
        hasMore: true,
        deletedExternalIds: [],
      },
      {
        entities: [
          {
            externalId: "item-2",
            entityType: "issue",
            title: "Second",
            data: { body: "page2" },
          },
        ],
        nextCursor: { page: 3 },
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "loop.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const db = getCollectionDb(dbPath);
    const rows = db.select().from(entities).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.externalId).sort()).toEqual(["item-1", "item-2"]);
  });

  it("inserts entities with SHA-256 content hash", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "hash-1",
            entityType: "doc",
            title: "Doc One",
            data: { text: "hello world" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "hash.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const db = getCollectionDb(dbPath);
    const [row] = db.select().from(entities).all();
    expect(row.contentHash).toBeTruthy();
    expect(row.contentHash!.length).toBe(64);
  });

  it("adds entity context to per-entity processing errors", async () => {
    themeEngine = new ThemeEngine();
    themeEngine.register({
      crawlerType: "mock",
      render(): string {
        throw new Error("render failed");
      },
      getFilePath(ctx: ThemeRenderContext): string {
        return `${ctx.entity.entityType}/${ctx.entity.externalId}.md`;
      },
    });

    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "item-404",
            entityType: "issue",
            title: "Broken",
            data: { body: "bad" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const engine = new SyncEngine({
      crawler,
      dbPath: join(TEST_DIR, "entity-context.db"),
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await expect(engine.run()).rejects.toThrow(
      "Failed to process entity type=issue id=item-404: render failed",
    );
  });

  it("skips re-render when content hash is unchanged", async () => {
    const entityData = {
      externalId: "skip-1",
      entityType: "doc",
      title: "Same Doc",
      data: { text: "unchanged content" },
    };

    const crawler1 = createMockCrawler([
      {
        entities: [entityData],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "skip.db");
    const engine1 = new SyncEngine({
      crawler: crawler1,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine1.run();

    const db = getCollectionDb(dbPath);
    const [first] = db.select().from(entities).all();
    const firstUpdatedAt = first.updatedAt;

    const crawler2 = createMockCrawler([
      {
        entities: [entityData],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const engine2 = new SyncEngine({
      crawler: crawler2,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine2.run();

    const [second] = db.select().from(entities).all();
    expect(second.updatedAt).toBe(firstUpdatedAt);

    const sync = getCollectionSyncState(dbPath);
    expect(sync.lastStatus).toBe("completed");
    expect(sync.lastUpdated).toBe(0);
    expect(sync.lastCreated).toBe(0);
  });

  it("refreshes FTS when source is unchanged but title/tags drift", async () => {
    const { SearchIndexer } = await import("../../search/indexer");
    const dbPath = join(TEST_DIR, "fts-drift.db");

    const sameSource = { body: "stable content" };

    const crawler1 = createMockCrawler([
      {
        entities: [{
          externalId: "drift-1",
          entityType: "doc",
          title: "Original Title",
          data: sameSource,
          tags: ["legacy"],
        }],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);
    await new SyncEngine({
      crawler: crawler1,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    }).run();

    // Second sync returns the same source but with a new title and new tags.
    const crawler2 = createMockCrawler([
      {
        entities: [{
          externalId: "drift-1",
          entityType: "doc",
          title: "Renamed Title",
          data: sameSource,
          tags: ["modern"],
        }],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);
    await new SyncEngine({
      crawler: crawler2,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    }).run();

    const indexer = new SearchIndexer(dbPath);
    expect(indexer.search("Renamed")).toHaveLength(1);
    expect(indexer.search("modern")).toHaveLength(1);
    expect(indexer.search("Original")).toHaveLength(0);
    expect(indexer.search("legacy")).toHaveLength(0);
    indexer.close();
  });

  it("re-renders when content hash changes", async () => {
    const dbPath = join(TEST_DIR, "rerender.db");

    const crawler1 = createMockCrawler([
      {
        entities: [
          {
            externalId: "change-1",
            entityType: "doc",
            title: "Doc V1",
            data: { text: "version one" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const engine1 = new SyncEngine({
      crawler: crawler1,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine1.run();

    const db = getCollectionDb(dbPath);
    const [first] = db.select().from(entities).all();

    const crawler2 = createMockCrawler([
      {
        entities: [
          {
            externalId: "change-1",
            entityType: "doc",
            title: "Doc V2",
            data: { text: "version two" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const engine2 = new SyncEngine({
      crawler: crawler2,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine2.run();

    const [second] = db.select().from(entities).all();
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(second.title).toBe("Doc V2");

    const mdContent = await storage.read("md/doc/change-1.md");
    expect(mdContent).toContain("Doc V2");
  });

  it("handles deletions from deletedExternalIds", async () => {
    const dbPath = join(TEST_DIR, "delete.db");

    const crawler1 = createMockCrawler([
      {
        entities: [
          {
            externalId: "del-1",
            entityType: "issue",
            title: "To Delete",
            data: { state: "open" },
            tags: ["bug"],
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const engine1 = new SyncEngine({
      crawler: crawler1,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine1.run();

    const db = getCollectionDb(dbPath);
    expect(db.select().from(entities).all()).toHaveLength(1);
    const [entity] = db.select().from(entities).all();
    expect((entity.data as EntityData).tags).toEqual(["bug"]);

    const crawler2 = createMockCrawler([
      {
        entities: [],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: ["del-1"],
      },
    ]);

    const engine2 = new SyncEngine({
      crawler: crawler2,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine2.run();

    expect(db.select().from(entities).all()).toHaveLength(0);

    const exists = await storage.exists("md/issue/del-1.md");
    expect(exists).toBe(false);

    const sync = getCollectionSyncState(dbPath);
    expect(sync.lastDeleted).toBe(1);
  });

  it("downloads attachments and stores them as entity JSON assets", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "att-1",
            entityType: "doc",
            title: "With Attachment",
            data: {},
            attachments: [
              {
                filename: "image.png",
                mimeType: "image/png",
                content: Buffer.from("fake-png-data"),
              },
            ],
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "attach.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const storedContent = await storage.read("md/doc/assets/image.png");
    expect(storedContent).toBe("fake-png-data");

    const db = getCollectionDb(dbPath);
    const [entity] = db.select().from(entities).all();
    const data = entity.data as EntityData;
    const assets = data.assets ?? [];
    expect(assets).toHaveLength(1);
    expect(assets[0].filename).toBe("image.png");
    expect(assets[0].mimeType).toBe("image/png");
    expect(assets[0].storagePath).toBe("md/doc/assets/image.png");
    expect(assets[0].hash).toBeTruthy();
  });

  it("persists sync cursor to the metadata DB", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "cur-1",
            entityType: "issue",
            title: "First",
            data: {},
          },
        ],
        nextCursor: { page: 2, since: "2024-01-01" },
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "cursor.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const sync = getCollectionSyncState(dbPath);
    expect(sync.cursor).toEqual({ page: 2, since: "2024-01-01" });
  });

  it("persists sync status, counts, and timing to metadata DB", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "run-1",
            entityType: "issue",
            title: "Created",
            data: { v: 1 },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "runs.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const sync = getCollectionSyncState(dbPath);
    expect(sync.lastStatus).toBe("completed");
    expect(sync.lastCreated).toBe(1);
    expect(sync.lastUpdated).toBe(0);
    expect(sync.lastDeleted).toBe(0);
    expect(sync.lastAt).toBeTruthy();
  });

  it("mirrors collection title, description, and version from YAML into the DB metadata", async () => {
    addCollection("mirror-test", {
      crawler: "mock",
      config: {},
      credentials: {},
      title: "My Repo",
      description: "Engineering notes",
      version: "2.1",
    });

    const crawler = createMockCrawler([
      { entities: [], nextCursor: null, hasMore: false, deletedExternalIds: [] },
    ]);

    const dbPath = join(TEST_DIR, "mirror.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "mirror-test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const store = new MetadataStore(dbPath);
    try {
      expect(store.getCollectionTitle()).toBe("My Repo");
      expect(store.getCollectionDescription()).toBe("Engineering notes");
      // The mock crawler's metadata.version is undefined, so engine falls back to "1.0"
      // and stamps that as the current version after sync — both in YAML and DB.
      expect(store.getCollectionVersion()).toBe("1.0");
    } finally {
      store.close();
    }
  });

  it("clears mirrored title/description when YAML values are empty", async () => {
    addCollection("clear-test", { crawler: "mock", config: {}, credentials: {} });

    const crawler = createMockCrawler([
      { entities: [], nextCursor: null, hasMore: false, deletedExternalIds: [] },
    ]);

    const dbPath = join(TEST_DIR, "clear.db");

    // Seed the DB with stale title/description
    const seed = new MetadataStore(dbPath);
    seed.set("title", "Stale Title");
    seed.set("description", "Stale Description");
    seed.close();

    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "clear-test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const store = new MetadataStore(dbPath);
    try {
      expect(store.getCollectionTitle()).toBeNull();
      expect(store.getCollectionDescription()).toBeNull();
    } finally {
      store.close();
    }
  });

  it("writes markdown files for new entities", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "md-1",
            entityType: "issue",
            title: "Markdown Test",
            data: { body: "test content" },
            tags: ["feature"],
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "markdown.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const content = await storage.read("md/issue/md-1.md");
    expect(content).toContain("# Markdown Test");
    expect(content).toContain("test content");

    const db = getCollectionDb(dbPath);
    const [row] = db.select().from(entities).all();
    expect(row.folder).toBe("issue");
    expect(row.slug).toBe("md-1");
  });

  it("stores tags as inline JSON on entities", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "tag-1",
            entityType: "issue",
            title: "Tagged",
            data: {},
            tags: ["bug", "critical", "frontend"],
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "tags.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const db = getCollectionDb(dbPath);
    const [entity] = db.select().from(entities).all();
    expect((entity.data as EntityData).tags).toEqual(["bug", "critical", "frontend"]);
  });

  it("reconcile: deletes orphaned markdown files not in DB", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "keep-1",
            entityType: "issue",
            title: "Keep This",
            data: { body: "keep" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "reconcile-orphan.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine.run();

    const orphanDir = join(TEST_DIR, "storage", "md", "issue");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "orphan-999.md"), "# Orphaned File");

    expect(await storage.exists("md/issue/orphan-999.md")).toBe(true);

    const crawler2 = createMockCrawler([
      {
        entities: [
          {
            externalId: "keep-1",
            entityType: "issue",
            title: "Keep This",
            data: { body: "keep" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);
    const engine2 = new SyncEngine({
      crawler: crawler2,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine2.run();

    expect(await storage.exists("md/issue/orphan-999.md")).toBe(false);
    expect(await storage.exists("md/issue/keep-1.md")).toBe(true);
  });

  it("reconcile: re-renders missing markdown files from DB data", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "restore-1",
            entityType: "doc",
            title: "Restore Me",
            data: { text: "important content" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "reconcile-restore.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine.run();

    expect(await storage.exists("md/doc/restore-1.md")).toBe(true);

    await storage.delete("md/doc/restore-1.md");
    expect(await storage.exists("md/doc/restore-1.md")).toBe(false);

    const crawler2 = createMockCrawler([
      {
        entities: [
          {
            externalId: "restore-1",
            entityType: "doc",
            title: "Restore Me",
            data: { text: "important content" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);
    const engine2 = new SyncEngine({
      crawler: crawler2,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine2.run();

    expect(await storage.exists("md/doc/restore-1.md")).toBe(true);
    const content = await storage.read("md/doc/restore-1.md");
    expect(content).toContain("Restore Me");
  });

  it("reconcile: preserves files inside hidden tool directories (.git, .obsidian)", async () => {
    const crawler = createMockCrawler([
      {
        entities: [],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "reconcile-toolpath.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await storage.write("md/.obsidian/workspace.json", '{"main":true}');
    await storage.write("content/assets/.git/config", "[core]");

    await engine.run();

    expect(await storage.exists("md/.obsidian/workspace.json")).toBe(true);
    expect(await storage.exists("content/assets/.git/config")).toBe(true);
  });

  it("stores outLinks and inLinks as entity JSON when wikilinks are found", async () => {
    const linkTheme: Theme = {
      crawlerType: "linktest",
      render(ctx: ThemeRenderContext): string {
        return `# ${ctx.entity.title}\n\nSee [[note/other-note]] and [[note/another|Another Note]].`;
      },
      getFilePath(ctx: ThemeRenderContext): string {
        return `${ctx.entity.entityType}/${ctx.entity.externalId}.md`;
      },
    };
    const linkEngine = new ThemeEngine();
    linkEngine.register(linkTheme);

    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "linker-1",
            entityType: "note",
            title: "Linker Note",
            data: { text: "links to others" },
          },
          {
            externalId: "other-note",
            entityType: "note",
            title: "Other Note",
            data: { text: "target 1" },
          },
          {
            externalId: "another",
            entityType: "note",
            title: "Another Note",
            data: { text: "target 2" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ], "linktest");

    const dbPath = join(TEST_DIR, "links.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine: linkEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine.run();

    const db = getCollectionDb(dbPath);
    const allEntities = db.select().from(entities).all();
    const linkerEntity = allEntities.find((e) => e.externalId === "linker-1")!;
    const otherEntity = allEntities.find((e) => e.externalId === "other-note")!;

    const linkerData = linkerEntity.data as EntityData;
    const outLinks: string[] = linkerData.out_links ?? [];
    expect(outLinks).toContain("other-note");

    // Target should have linker in its inLinks
    const otherData = otherEntity.data as EntityData;
    const inLinks: string[] = otherData.in_links ?? [];
    expect(inLinks).toContain("linker-1");
  });

  it("extracts standard markdown links and resolves relative paths", () => {
    const md1 = "See [def](def.md) for the parent commit.";
    expect(extractWikilinks(md1, "commits/abc.md")).toEqual(["commits/def"]);

    const md2 = "Tip: [abc](../commits/abc.md)";
    expect(extractWikilinks(md2, "branches/main.md")).toEqual(["commits/abc"]);

    const md3 = "[a](a.md) and [b](../issues/b.md)";
    expect(extractWikilinks(md3, "commits/x.md").sort()).toEqual(["commits/a", "issues/b"]);
  });

  it("excludes image links and external URLs from extraction", () => {
    const md = "![img](../../attachments/pic.md) and [ext](https://example.com/page.md) and [local](sibling.md)";
    expect(extractWikilinks(md, "issues/42.md")).toEqual(["issues/sibling"]);
  });

  it("extracts legacy Obsidian wikilinks alongside standard links", () => {
    const md = "[[legacy/target]] and [standard](../standard/link.md)";
    const targets = extractWikilinks(md, "issues/42.md");
    expect(targets).toContain("legacy/target");
    expect(targets).toContain("standard/link");
  });

  it("handles extractWikilinks without sourceFilePath (root-relative)", () => {
    const md = "[label](commits/abc.md)";
    expect(extractWikilinks(md)).toEqual(["commits/abc"]);
  });

  it("cleans up inLinks when an entity is deleted", async () => {
    const linkTheme: Theme = {
      crawlerType: "linktest",
      render(ctx: ThemeRenderContext): string {
        return `# ${ctx.entity.title}\n\nSee [[note/target]].`;
      },
      getFilePath(ctx: ThemeRenderContext): string {
        return `${ctx.entity.entityType}/${ctx.entity.externalId}.md`;
      },
    };
    const linkEngine = new ThemeEngine();
    linkEngine.register(linkTheme);

    const crawler1 = createMockCrawler([
      {
        entities: [
          {
            externalId: "delme-1",
            entityType: "note",
            title: "Delete Me",
            data: {},
          },
          {
            externalId: "target",
            entityType: "note",
            title: "Target",
            data: {},
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ], "linktest");

    const dbPath = join(TEST_DIR, "links-delete.db");
    const engine1 = new SyncEngine({
      crawler: crawler1,
      dbPath,
      collectionName: "test",
      themeEngine: linkEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine1.run();

    const db = getCollectionDb(dbPath);
    const linkerEntity = db.select().from(entities).where(eq(entities.externalId, "delme-1")).all()[0];
    const linkerData = linkerEntity.data as EntityData;
    expect((linkerData.out_links ?? []).length).toBeGreaterThan(0);

    const crawler2 = createMockCrawler([
      {
        entities: [
          {
            externalId: "target",
            entityType: "note",
            title: "Target",
            data: {},
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: ["delme-1"],
      },
    ], "linktest");
    const engine2 = new SyncEngine({
      crawler: crawler2,
      dbPath,
      collectionName: "test",
      themeEngine: linkEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine2.run();

    // The deleted entity should be gone
    expect(db.select().from(entities).where(eq(entities.externalId, "delme-1")).all()).toHaveLength(0);
    // The target should have empty inLinks
    const targetEntity = db.select().from(entities).where(eq(entities.externalId, "target")).all()[0];
    const targetData = targetEntity.data as EntityData;
    expect(targetData.in_links ?? []).not.toContain("delme-1");
  });
});
