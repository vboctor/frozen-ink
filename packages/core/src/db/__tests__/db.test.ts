import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { getCollectionDb } from "../client";
import {
  entities,
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

    expect(db.select().from(entities).all()).toEqual([]);
  });

  it("supports CRUD on entities", () => {
    const dbPath = join(TEST_DIR, "collection-entities.db");
    const db = getCollectionDb(dbPath);

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

    db.update(entities)
      .set({ title: "Fix critical bug" })
      .where(eq(entities.id, rows[0].id))
      .run();

    const updated = db.select().from(entities).where(eq(entities.id, rows[0].id)).all();
    expect(updated[0].title).toBe("Fix critical bug");

    db.delete(entities).where(eq(entities.id, rows[0].id)).run();
    expect(db.select().from(entities).all()).toHaveLength(0);
  });

  it("supports inline tags on entities", () => {
    const dbPath = join(TEST_DIR, "collection-tags.db");
    const db = getCollectionDb(dbPath);

    db.insert(entities)
      .values({
        externalId: "pr-1",
        entityType: "pull_request",
        title: "Add feature",
        data: {},
        tags: ["enhancement", "frontend"],
      })
      .run();

    const [entity] = db.select().from(entities).all();
    expect((entity as any).tags).toEqual(["enhancement", "frontend"]);
  });

  it("supports inline assets on entities", () => {
    const dbPath = join(TEST_DIR, "collection-assets.db");
    const db = getCollectionDb(dbPath);

    db.insert(entities)
      .values({
        externalId: "doc-1",
        entityType: "document",
        title: "Readme",
        data: {},
        assets: [{ filename: "screenshot.png", mimeType: "image/png", storagePath: "assets/screenshot.png", hash: "abc123" }],
      })
      .run();

    const [entity] = db.select().from(entities).all();
    const assets: any[] = (entity as any).assets;
    expect(assets).toHaveLength(1);
    expect(assets[0].filename).toBe("screenshot.png");
  });

  it("supports inline links on entities", () => {
    const dbPath = join(TEST_DIR, "collection-links.db");
    const db = getCollectionDb(dbPath);

    db.insert(entities)
      .values({
        externalId: "issue-1",
        entityType: "issue",
        title: "Issue 1",
        data: {},
        outLinks: ["issue-2", "issue-3"],
        inLinks: ["issue-4"],
      })
      .run();

    const [entity] = db.select().from(entities).all();
    expect((entity as any).outLinks).toEqual(["issue-2", "issue-3"]);
    expect((entity as any).inLinks).toEqual(["issue-4"]);
  });

});
