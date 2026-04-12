import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { SyncEngine } from "../sync-engine";
import { getCollectionDb } from "../../db/client";
import {
  entities,
  tags,
  entityTags,
  assets,
  links,
  syncState,
  syncRuns,
} from "../../db/collection-schema";
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
  themeEngine = new ThemeEngine();
  themeEngine.register(createMockTheme());
  storage = new LocalStorageBackend(join(TEST_DIR, "storage"));
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
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
    expect(row.contentHash!.length).toBe(64); // SHA-256 hex length
  });

  it("skips re-render when content hash is unchanged", async () => {
    const entityData = {
      externalId: "skip-1",
      entityType: "doc",
      title: "Same Doc",
      data: { text: "unchanged content" },
    };

    // First sync
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

    // Second sync with same data — should skip update
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
    // updatedAt should remain the same since content didn't change
    expect(second.updatedAt).toBe(firstUpdatedAt);

    // Sync runs should show 0 updated on second run
    const runs = db.select().from(syncRuns).all();
    expect(runs).toHaveLength(2);
    expect(runs[1].entitiesUpdated).toBe(0);
    expect(runs[1].entitiesCreated).toBe(0);
  });

  it("re-renders when content hash changes", async () => {
    const dbPath = join(TEST_DIR, "rerender.db");

    // First sync
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

    // Second sync with changed data
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

    // Verify markdown was updated
    const mdContent = await storage.read("md/doc/change-1.md");
    expect(mdContent).toContain("Doc V2");
  });

  it("handles deletions from deletedExternalIds", async () => {
    const dbPath = join(TEST_DIR, "delete.db");

    // First sync — create an entity
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
    expect(db.select().from(entityTags).all()).toHaveLength(1);

    // Second sync — delete it
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
    expect(db.select().from(entityTags).all()).toHaveLength(0);

    // Verify markdown file was deleted
    const exists = await storage.exists("md/issue/del-1.md");
    expect(exists).toBe(false);

    // sync_runs should record the deletion
    const runs = db.select().from(syncRuns).all();
    expect(runs[1].entitiesDeleted).toBe(1);
  });

  it("downloads attachments via storage backend", async () => {
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

    // Check attachment was stored
    const storedContent = await storage.read("content/doc/assets/image.png");
    expect(storedContent).toBe("fake-png-data");

    // Check attachment record in DB
    const db = getCollectionDb(dbPath);
    const atts = db.select().from(assets).all();
    expect(atts).toHaveLength(1);
    expect(atts[0].filename).toBe("image.png");
    expect(atts[0].mimeType).toBe("image/png");
    expect(atts[0].storagePath).toBe("content/doc/assets/image.png");
  });

  it("updates sync_state with latest cursor", async () => {
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

    const db = getCollectionDb(dbPath);
    const states = db.select().from(syncState).all();
    expect(states).toHaveLength(1);
    expect(states[0].crawlerType).toBe("mock");
    expect(states[0].cursor).toEqual({ page: 2, since: "2024-01-01" });
  });

  it("creates sync_runs with status, counts, and timing", async () => {
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

    const db = getCollectionDb(dbPath);
    const runs = db.select().from(syncRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].entitiesCreated).toBe(1);
    expect(runs[0].entitiesUpdated).toBe(0);
    expect(runs[0].entitiesDeleted).toBe(0);
    expect(runs[0].startedAt).toBeTruthy();
    expect(runs[0].completedAt).toBeTruthy();
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

    // Verify DB has markdown_path
    const db = getCollectionDb(dbPath);
    const [row] = db.select().from(entities).all();
    expect(row.markdownPath).toBe("md/issue/md-1.md");
  });

  it("inserts tags for entities", async () => {
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
    const entityTagRows = db.select().from(entityTags).all();
    expect(entityTagRows).toHaveLength(3);
    const tagRows = db.select().from(tags).all();
    const tagNames = entityTagRows
      .map((et) => tagRows.find((t) => t.id === et.tagId)!.name)
      .sort();
    expect(tagNames).toEqual(["bug", "critical", "frontend"]);
  });

  it("reconcile: deletes orphaned markdown files not in DB", async () => {
    // Create an entity via sync
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

    // Manually create an orphaned markdown file (no DB entity)
    const orphanDir = join(TEST_DIR, "storage", "md", "issue");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "orphan-999.md"), "# Orphaned File");

    // Verify it exists
    expect(await storage.exists("md/issue/orphan-999.md")).toBe(true);

    // Run sync again — reconcile should delete the orphan
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

    // Orphaned file should be gone
    expect(await storage.exists("md/issue/orphan-999.md")).toBe(false);
    // Legitimate file should still exist
    expect(await storage.exists("md/issue/keep-1.md")).toBe(true);
  });

  it("reconcile: re-renders missing markdown files from DB data", async () => {
    // Create an entity via sync
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

    // Verify file exists
    expect(await storage.exists("md/doc/restore-1.md")).toBe(true);

    // Manually delete the markdown file
    await storage.delete("md/doc/restore-1.md");
    expect(await storage.exists("md/doc/restore-1.md")).toBe(false);

    // Run sync again — reconcile should re-render the file
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

    // File should be restored
    expect(await storage.exists("md/doc/restore-1.md")).toBe(true);
    const content = await storage.read("md/doc/restore-1.md");
    expect(content).toContain("Restore Me");
  });

  it("reconcile: deletes orphaned attachment files not in DB", async () => {
    // Create entity with attachment
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "att-keep",
            entityType: "doc",
            title: "With Attachment",
            data: {},
            attachments: [
              {
                filename: "real.png",
                mimeType: "image/png",
                content: Buffer.from("real-data"),
              },
            ],
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "reconcile-att.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine.run();

    // Manually create an orphaned attachment file
    await storage.write("content/doc/assets/stale.png", Buffer.from("orphan-data"));
    expect(await storage.exists("content/doc/assets/stale.png")).toBe(true);

    // Run sync again — reconcile should clean up
    const crawler2 = createMockCrawler([
      {
        entities: [
          {
            externalId: "att-keep",
            entityType: "doc",
            title: "With Attachment",
            data: {},
            attachments: [
              {
                filename: "real.png",
                mimeType: "image/png",
                content: Buffer.from("real-data"),
              },
            ],
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

    // Orphaned attachment should be gone
    expect(await storage.exists("content/doc/assets/stale.png")).toBe(false);
    // Legitimate attachment should still exist
    expect(await storage.exists("content/doc/assets/real.png")).toBe(true);
  });

  it("reconcile: cleans up attachment DB records for missing files", async () => {
    // Create entity with attachment
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "att-clean",
            entityType: "doc",
            title: "Cleanup Test",
            data: {},
            attachments: [
              {
                filename: "gone.png",
                mimeType: "image/png",
                content: Buffer.from("will-be-deleted"),
              },
            ],
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "reconcile-clean.db");
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
    expect(db.select().from(assets).all()).toHaveLength(1);

    // Manually delete the attachment file from disk
    await storage.delete("content/doc/assets/gone.png");

    // Run sync again with no attachments (so DB record stays from first sync)
    const crawler2 = createMockCrawler([
      {
        entities: [
          {
            externalId: "att-clean",
            entityType: "doc",
            title: "Cleanup Test",
            data: {},
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

    // DB attachment record should be cleaned up since file is missing
    expect(db.select().from(assets).all()).toHaveLength(0);
  });

  it("reconcile: restores user-modified markdown files to expected content", async () => {
    const crawler = createMockCrawler([
      {
        entities: [
          {
            externalId: "modified-1",
            entityType: "note",
            title: "Original Title",
            data: { body: "original body" },
          },
        ],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "reconcile-modified.db");
    const engine = new SyncEngine({
      crawler,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });
    await engine.run();

    // Manually overwrite the markdown with wrong content
    await storage.write("md/note/modified-1.md", "user scribbled here");
    expect(await storage.read("md/note/modified-1.md")).toBe(
      "user scribbled here",
    );

    // Run sync again — reconcile should restore the correct content
    const crawler2 = createMockCrawler([
      {
        entities: [
          {
            externalId: "modified-1",
            entityType: "note",
            title: "Original Title",
            data: { body: "original body" },
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

    const content = await storage.read("md/note/modified-1.md");
    expect(content).toContain("Original Title");
    expect(content).not.toBe("user scribbled here");
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

    // Simulate tool-generated index files inside the output directory
    await storage.write("md/.obsidian/workspace.json", '{"main":true}');
    await storage.write("content/assets/.git/config", "[core]");

    await engine.run();

    // Tool files must not be touched
    expect(await storage.exists("md/.obsidian/workspace.json")).toBe(true);
    expect(await storage.exists("content/assets/.git/config")).toBe(true);
  });

  it("extracts wikilinks from rendered markdown and stores them as links", async () => {
    // Create a theme that generates wikilinks to entities that exist
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
    const anotherEntity = allEntities.find((e) => e.externalId === "another")!;

    const linkRows = db.select().from(links).all();

    // Should have 2 links from linker-1 to the two target entities
    const linkerLinks = linkRows.filter((l) => l.sourceEntityId === linkerEntity.id);
    expect(linkerLinks).toHaveLength(2);
    const targetIds = linkerLinks.map((l) => l.targetEntityId).sort();
    expect(targetIds).toEqual([otherEntity.id, anotherEntity.id].sort());
  });

  it("cleans up links when an entity is deleted", async () => {
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

    // First sync: create entity with links (including the target)
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
    expect(db.select().from(links).all()).toHaveLength(1);

    // Second sync: delete the source entity
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

    // Links should be cleaned up
    expect(db.select().from(links).all()).toHaveLength(0);
  });
});
