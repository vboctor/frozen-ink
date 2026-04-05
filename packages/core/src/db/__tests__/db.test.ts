import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { getMasterDb, getCollectionDb } from "../client";
import { collections } from "../master-schema";
import {
  entities,
  entityTags,
  attachments,
  syncState,
  syncRuns,
  entityRelations,
} from "../collection-schema";

const TEST_DIR = join(import.meta.dir, ".test-dbs");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Master Database", () => {
  it("creates a database with collections table", () => {
    const dbPath = join(TEST_DIR, "master.db");
    const db = getMasterDb(dbPath);

    expect(existsSync(dbPath)).toBe(true);

    // Verify collections table exists by querying it
    const result = db.select().from(collections).all();
    expect(result).toEqual([]);
  });

  it("supports CRUD operations on collections", () => {
    const dbPath = join(TEST_DIR, "master-crud.db");
    const db = getMasterDb(dbPath);

    // Create
    db.insert(collections)
      .values({
        name: "My GitHub",
        connectorType: "github",
        config: { org: "acme" },
        credentials: { token: "ghp_xxx" },
        dbPath: "/data/github.db",
      })
      .run();

    // Read
    const rows = db.select().from(collections).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("My GitHub");
    expect(rows[0].connectorType).toBe("github");
    expect(rows[0].config).toEqual({ org: "acme" });
    expect(rows[0].credentials).toEqual({ token: "ghp_xxx" });
    expect(rows[0].syncInterval).toBe(3600);
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].dbPath).toBe("/data/github.db");
    expect(rows[0].createdAt).toBeTruthy();
    expect(rows[0].updatedAt).toBeTruthy();

    // Update
    db.update(collections)
      .set({ enabled: false })
      .where(eq(collections.id, rows[0].id))
      .run();

    const updated = db.select().from(collections).where(eq(collections.id, rows[0].id)).all();
    expect(updated[0].enabled).toBe(false);

    // Delete
    db.delete(collections).where(eq(collections.id, rows[0].id)).run();
    const afterDelete = db.select().from(collections).all();
    expect(afterDelete).toHaveLength(0);
  });
});

describe("Collection Database", () => {
  it("creates a database with all required tables", () => {
    const dbPath = join(TEST_DIR, "collection.db");
    const db = getCollectionDb(dbPath);

    expect(existsSync(dbPath)).toBe(true);

    // Verify all tables exist by querying them
    expect(db.select().from(entities).all()).toEqual([]);
    expect(db.select().from(entityTags).all()).toEqual([]);
    expect(db.select().from(attachments).all()).toEqual([]);
    expect(db.select().from(syncState).all()).toEqual([]);
    expect(db.select().from(syncRuns).all()).toEqual([]);
    expect(db.select().from(entityRelations).all()).toEqual([]);
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

  it("supports entity_tags with foreign key to entities", () => {
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

    db.insert(entityTags).values({ entityId: entity.id, tag: "enhancement" }).run();
    db.insert(entityTags).values({ entityId: entity.id, tag: "frontend" }).run();

    const tags = db
      .select()
      .from(entityTags)
      .where(eq(entityTags.entityId, entity.id))
      .all();
    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.tag).sort()).toEqual(["enhancement", "frontend"]);
  });

  it("supports attachments", () => {
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

    db.insert(attachments)
      .values({
        entityId: entity.id,
        filename: "screenshot.png",
        mimeType: "image/png",
        storagePath: "/attachments/screenshot.png",
        backend: "local",
      })
      .run();

    const rows = db
      .select()
      .from(attachments)
      .where(eq(attachments.entityId, entity.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe("screenshot.png");
    expect(rows[0].backend).toBe("local");
  });

  it("supports sync_state and sync_runs", () => {
    const dbPath = join(TEST_DIR, "collection-sync.db");
    const db = getCollectionDb(dbPath);

    // sync_state
    db.insert(syncState)
      .values({
        connectorType: "github",
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

  it("supports entity_relations", () => {
    const dbPath = join(TEST_DIR, "collection-relations.db");
    const db = getCollectionDb(dbPath);

    // Create two entities
    db.insert(entities)
      .values([
        { externalId: "issue-1", entityType: "issue", title: "Bug report", data: {} },
        { externalId: "pr-1", entityType: "pull_request", title: "Fix for bug", data: {} },
      ])
      .run();

    const allEntities = db.select().from(entities).all();
    expect(allEntities).toHaveLength(2);

    // Create a relation
    db.insert(entityRelations)
      .values({
        sourceEntityId: allEntities[0].id,
        targetEntityId: allEntities[1].id,
        relationType: "fixes",
      })
      .run();

    const relations = db.select().from(entityRelations).all();
    expect(relations).toHaveLength(1);
    expect(relations[0].relationType).toBe("fixes");
    expect(relations[0].sourceEntityId).toBe(allEntities[0].id);
    expect(relations[0].targetEntityId).toBe(allEntities[1].id);
  });
});
