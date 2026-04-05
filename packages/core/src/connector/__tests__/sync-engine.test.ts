import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { SyncEngine } from "../sync-engine";
import { getCollectionDb } from "../../db/client";
import {
  entities,
  entityTags,
  attachments,
  syncState,
  syncRuns,
} from "../../db/collection-schema";
import { ThemeEngine } from "../../theme/engine";
import { LocalStorageBackend } from "../../storage/local";
import type { Connector, SyncCursor, SyncResult } from "../interface";
import type { Theme, ThemeRenderContext } from "../../theme/interface";

const TEST_DIR = join(import.meta.dir, ".test-sync");

function createMockTheme(): Theme {
  return {
    connectorType: "mock",
    render(ctx: ThemeRenderContext): string {
      return `# ${ctx.entity.title}\n\n${JSON.stringify(ctx.entity.data)}`;
    },
    getFilePath(ctx: ThemeRenderContext): string {
      return `${ctx.entity.entityType}/${ctx.entity.externalId}.md`;
    },
  };
}

function createMockConnector(pages: SyncResult[]): Connector {
  let callIndex = 0;
  return {
    metadata: {
      type: "mock",
      displayName: "Mock Connector",
      description: "A mock connector for testing",
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
  it("loops connector.sync() until hasMore is false", async () => {
    const connector = createMockConnector([
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
      connector,
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
    const connector = createMockConnector([
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
      connector,
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
    const connector1 = createMockConnector([
      {
        entities: [entityData],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const dbPath = join(TEST_DIR, "skip.db");
    const engine1 = new SyncEngine({
      connector: connector1,
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
    const connector2 = createMockConnector([
      {
        entities: [entityData],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: [],
      },
    ]);

    const engine2 = new SyncEngine({
      connector: connector2,
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
    const connector1 = createMockConnector([
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
      connector: connector1,
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
    const connector2 = createMockConnector([
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
      connector: connector2,
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
    const connector1 = createMockConnector([
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
      connector: connector1,
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
    const connector2 = createMockConnector([
      {
        entities: [],
        nextCursor: null,
        hasMore: false,
        deletedExternalIds: ["del-1"],
      },
    ]);

    const engine2 = new SyncEngine({
      connector: connector2,
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
    const connector = createMockConnector([
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
      connector,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    // Check attachment was stored
    const storedContent = await storage.read("attachments/att-1/image.png");
    expect(storedContent).toBe("fake-png-data");

    // Check attachment record in DB
    const db = getCollectionDb(dbPath);
    const atts = db.select().from(attachments).all();
    expect(atts).toHaveLength(1);
    expect(atts[0].filename).toBe("image.png");
    expect(atts[0].mimeType).toBe("image/png");
    expect(atts[0].storagePath).toBe("attachments/att-1/image.png");
  });

  it("updates sync_state with latest cursor", async () => {
    const connector = createMockConnector([
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
      connector,
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
    expect(states[0].connectorType).toBe("mock");
    expect(states[0].cursor).toEqual({ page: 2, since: "2024-01-01" });
  });

  it("creates sync_runs with status, counts, and timing", async () => {
    const connector = createMockConnector([
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
      connector,
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
    const connector = createMockConnector([
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
      connector,
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
    const connector = createMockConnector([
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
      connector,
      dbPath,
      collectionName: "test",
      themeEngine,
      storage,
      markdownBasePath: "md",
    });

    await engine.run();

    const db = getCollectionDb(dbPath);
    const tags = db.select().from(entityTags).all();
    expect(tags).toHaveLength(3);
    expect(tags.map((t) => t.tag).sort()).toEqual(["bug", "critical", "frontend"]);
  });
});
