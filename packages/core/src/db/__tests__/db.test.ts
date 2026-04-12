import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { getCollectionDb } from "../client";
import {
  entities,
  tags,
  entityTags,
  assets,
  syncState,
  syncRuns,
} from "../collection-schema";

const TEST_DIR = join(import.meta.dir, ".test-dbs");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Collection Database", () => {
  it("creates a database with all required tables", () => {
    const dbPath = join(TEST_DIR, "collection.db");
    const db = getCollectionDb(dbPath);

    expect(existsSync(dbPath)).toBe(true);

    // Verify all tables exist by querying them
    expect(db.select().from(entities).all()).toEqual([]);
    expect(db.select().from(entityTags).all()).toEqual([]);
    expect(db.select().from(assets).all()).toEqual([]);
    expect(db.select().from(syncState).all()).toEqual([]);
    expect(db.select().from(syncRuns).all()).toEqual([]);
  });

  it("supports CRUD on entities", () => {
    const dbPath = join(TEST_DIR, "collection-entities.db");
    const db = getCollectionDb(dbPath);

    // Create
    db.insert(entities)
      .values({
        externalId: "issue-123",
        entityType: "issue",
        title: "Fix bug",
        data: { state: "open", labels: ["bug"] },
        contentHash: "abc123",
        url: "https://github.com/org/repo/issues/123",
      })
      .run();

    const rows = db.select().from(entities).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].externalId).toBe("issue-123");
    expect(rows[0].entityType).toBe("issue");
    expect(rows[0].title).toBe("Fix bug");
    expect(rows[0].data).toEqual({ state: "open", labels: ["bug"] });
    expect(rows[0].contentHash).toBe("abc123");

    // Update
    db.update(entities)
      .set({ title: "Fix critical bug" })
      .where(eq(entities.id, rows[0].id))
      .run();

    const updated = db.select().from(entities).where(eq(entities.id, rows[0].id)).all();
    expect(updated[0].title).toBe("Fix critical bug");

    // Delete
    db.delete(entities).where(eq(entities.id, rows[0].id)).run();
    expect(db.select().from(entities).all()).toHaveLength(0);
  });

  it("supports entity_tags with foreign key to entities and tags", () => {
    const dbPath = join(TEST_DIR, "collection-tags.db");
    const db = getCollectionDb(dbPath);

    db.insert(entities)
      .values({
        externalId: "pr-1",
        entityType: "pull_request",
        title: "Add feature",
        data: {},
      })
      .run();

    const [entity] = db.select().from(entities).all();

    // Insert into tags table first
    db.insert(tags).values({ name: "enhancement" }).run();
    db.insert(tags).values({ name: "frontend" }).run();
    const allTags = db.select().from(tags).all();
    const enhancementTag = allTags.find((t) => t.name === "enhancement")!;
    const frontendTag = allTags.find((t) => t.name === "frontend")!;

    db.insert(entityTags).values({ entityId: entity.id, tagId: enhancementTag.id }).run();
    db.insert(entityTags).values({ entityId: entity.id, tagId: frontendTag.id }).run();

    const entityTagRows = db
      .select()
      .from(entityTags)
      .where(eq(entityTags.entityId, entity.id))
      .all();
    expect(entityTagRows).toHaveLength(2);
    expect(entityTagRows.map((t) => t.tagId).sort()).toEqual(
      [enhancementTag.id, frontendTag.id].sort(),
    );
  });

  it("supports assets", () => {
    const dbPath = join(TEST_DIR, "collection-attach.db");
    const db = getCollectionDb(dbPath);

    db.insert(entities)
      .values({
        externalId: "doc-1",
        entityType: "document",
        title: "Readme",
        data: {},
      })
      .run();

    const [entity] = db.select().from(entities).all();

    db.insert(assets)
      .values({
        entityId: entity.id,
        filename: "screenshot.png",
        mimeType: "image/png",
        storagePath: "/attachments/screenshot.png",
      })
      .run();

    const rows = db
      .select()
      .from(assets)
      .where(eq(assets.entityId, entity.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe("screenshot.png");
  });

  it("supports tags table with unique name", () => {
    const dbPath = join(TEST_DIR, "collection-tags-table.db");
    const db = getCollectionDb(dbPath);

    db.insert(tags).values({ name: "bug" }).run();
    db.insert(tags).values({ name: "feature" }).run();

    const allTags = db.select().from(tags).all();
    expect(allTags).toHaveLength(2);
    expect(allTags.map((t) => t.name).sort()).toEqual(["bug", "feature"]);
    expect(allTags[0].id).toBeTruthy();
  });

  it("supports sync_state and sync_runs", () => {
    const dbPath = join(TEST_DIR, "collection-sync.db");
    const db = getCollectionDb(dbPath);

    // sync_state
    db.insert(syncState)
      .values({
        crawlerType: "github",
        cursor: { since: "2024-01-01T00:00:00Z" },
      })
      .run();

    const states = db.select().from(syncState).all();
    expect(states).toHaveLength(1);
    expect(states[0].cursor).toEqual({ since: "2024-01-01T00:00:00Z" });

    // sync_runs
    db.insert(syncRuns)
      .values({
        status: "completed",
        entitiesCreated: 10,
        entitiesUpdated: 5,
        entitiesDeleted: 2,
        errors: [],
      })
      .run();

    const runs = db.select().from(syncRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].entitiesCreated).toBe(10);
  });

});
