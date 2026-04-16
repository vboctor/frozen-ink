import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { SearchIndexer } from "../indexer";
import { buildFtsQuery } from "../fts-query";

const TEST_DIR = join(import.meta.dir, ".test-search");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("SearchIndexer", () => {
  it("creates FTS5 virtual table", () => {
    const dbPath = join(TEST_DIR, "fts-create.db");
    const indexer = new SearchIndexer(dbPath);

    // Index a document and search for it
    indexer.updateIndex({
      id: 1,
      externalId: "ext-1",
      entityType: "issue",
      title: "Test Issue",
      content: "This is test content",
      tags: ["bug"],
    });

    const results = indexer.search("test");
    expect(results).toHaveLength(1);
    expect(results[0].entityId).toBe(1);

    indexer.close();
  });

  it("indexes title, content, and tags", () => {
    const dbPath = join(TEST_DIR, "fts-fields.db");
    const indexer = new SearchIndexer(dbPath);

    indexer.updateIndex({
      id: 1,
      externalId: "ext-1",
      entityType: "doc",
      title: "Authentication Guide",
      content: "How to set up OAuth2 login flow",
      tags: ["security", "auth"],
    });

    // Search by title
    expect(indexer.search("Authentication")).toHaveLength(1);

    // Search by content
    expect(indexer.search("OAuth2")).toHaveLength(1);

    // Search by tag
    expect(indexer.search("security")).toHaveLength(1);

    indexer.close();
  });

  it("returns relevant results with entity details", () => {
    const dbPath = join(TEST_DIR, "fts-details.db");
    const indexer = new SearchIndexer(dbPath);

    indexer.updateIndex({
      id: 42,
      externalId: "issue-42",
      entityType: "issue",
      title: "Fix database performance",
      content: "Optimize slow queries in the dashboard",
      tags: ["performance", "database"],
    });

    const results = indexer.search("database");
    expect(results).toHaveLength(1);
    expect(results[0].entityId).toBe(42);
    expect(results[0].externalId).toBe("issue-42");
    expect(results[0].entityType).toBe("issue");
    expect(results[0].title).toBe("Fix database performance");
    expect(typeof results[0].rank).toBe("number");

    indexer.close();
  });

  it("supports entityType filter", () => {
    const dbPath = join(TEST_DIR, "fts-filter.db");
    const indexer = new SearchIndexer(dbPath);

    indexer.updateIndex({
      id: 1,
      externalId: "issue-1",
      entityType: "issue",
      title: "Bug report for API",
      content: "API returns 500 on login",
      tags: ["bug"],
    });

    indexer.updateIndex({
      id: 2,
      externalId: "doc-1",
      entityType: "document",
      title: "API Documentation",
      content: "REST API guide",
      tags: ["docs"],
    });

    // Without filter — both match
    const allResults = indexer.search("API");
    expect(allResults).toHaveLength(2);

    // With entityType filter
    const issueOnly = indexer.search("API", { entityType: "issue" });
    expect(issueOnly).toHaveLength(1);
    expect(issueOnly[0].entityType).toBe("issue");

    const docOnly = indexer.search("API", { entityType: "document" });
    expect(docOnly).toHaveLength(1);
    expect(docOnly[0].entityType).toBe("document");

    indexer.close();
  });

  it("updates index for existing entity", () => {
    const dbPath = join(TEST_DIR, "fts-update.db");
    const indexer = new SearchIndexer(dbPath);

    indexer.updateIndex({
      id: 1,
      externalId: "ext-1",
      entityType: "issue",
      title: "Old Title",
      content: "Old content about widgets",
      tags: ["legacy"],
    });

    // Update same entity
    indexer.updateIndex({
      id: 1,
      externalId: "ext-1",
      entityType: "issue",
      title: "New Title",
      content: "New content about gadgets",
      tags: ["modern"],
    });

    // Old content should not match
    expect(indexer.search("widgets")).toHaveLength(0);
    expect(indexer.search("legacy")).toHaveLength(0);

    // New content should match
    const results = indexer.search("gadgets");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("New Title");

    indexer.close();
  });

  it("removes entity from index", () => {
    const dbPath = join(TEST_DIR, "fts-remove.db");
    const indexer = new SearchIndexer(dbPath);

    indexer.updateIndex({
      id: 1,
      externalId: "ext-1",
      entityType: "issue",
      title: "Removable Item",
      content: "This will be removed",
      tags: [],
    });

    expect(indexer.search("Removable")).toHaveLength(1);

    indexer.removeIndex(1);
    expect(indexer.search("Removable")).toHaveLength(0);

    indexer.close();
  });

  it("handles multiple entities and ranks by relevance", () => {
    const dbPath = join(TEST_DIR, "fts-rank.db");
    const indexer = new SearchIndexer(dbPath);

    indexer.updateIndex({
      id: 1,
      externalId: "ext-1",
      entityType: "doc",
      title: "React Component Guide",
      content: "How to build React components with hooks",
      tags: ["react", "frontend"],
    });

    indexer.updateIndex({
      id: 2,
      externalId: "ext-2",
      entityType: "doc",
      title: "Vue Guide",
      content: "Building Vue applications",
      tags: ["vue", "frontend"],
    });

    indexer.updateIndex({
      id: 3,
      externalId: "ext-3",
      entityType: "doc",
      title: "React Testing",
      content: "Testing React components with jest",
      tags: ["react", "testing"],
    });

    // "React" matches 2 docs
    const reactResults = indexer.search("React");
    expect(reactResults).toHaveLength(2);

    // "frontend" matches 2 docs (via tags)
    const frontendResults = indexer.search("frontend");
    expect(frontendResults).toHaveLength(2);

    // "Vue" matches only 1
    const vueResults = indexer.search("Vue");
    expect(vueResults).toHaveLength(1);
    expect(vueResults[0].externalId).toBe("ext-2");

    indexer.close();
  });

  it("ranks title matches ahead of content matches", () => {
    const dbPath = join(TEST_DIR, "fts-title-rank.db");
    const indexer = new SearchIndexer(dbPath);

    // Entity A: "widget" only in content
    indexer.updateIndex({
      id: 1,
      externalId: "a",
      entityType: "issue",
      title: "Authentication flow broken",
      content: "The widget submission path fails at step two.",
      tags: [],
    });

    // Entity B: "widget" in title
    indexer.updateIndex({
      id: 2,
      externalId: "b",
      entityType: "issue",
      title: "Widget rendering regression",
      content: "The page loads but nothing appears.",
      tags: [],
    });

    const results = indexer.search("widget");
    expect(results).toHaveLength(2);
    // The title match should outrank the content-only match.
    expect(results[0].externalId).toBe("b");
    expect(results[1].externalId).toBe("a");
    indexer.close();
  });

  it("refreshTitleAndTags rewrites only title/tags and leaves content searchable", () => {
    const dbPath = join(TEST_DIR, "fts-refresh.db");
    const indexer = new SearchIndexer(dbPath);

    indexer.updateIndex({
      id: 1,
      externalId: "ext-1",
      entityType: "issue",
      title: "Old Title",
      content: "Narwhals in the pipeline",
      tags: ["legacy"],
    });

    indexer.refreshTitleAndTags(1, "New Title", ["modern"]);

    // New title and tag are findable
    expect(indexer.search("New")).toHaveLength(1);
    expect(indexer.search("modern")).toHaveLength(1);
    // Old title and tag are no longer findable
    expect(indexer.search("Old")).toHaveLength(0);
    expect(indexer.search("legacy")).toHaveLength(0);
    // Content is preserved
    expect(indexer.search("Narwhals")).toHaveLength(1);

    indexer.close();
  });

  it("expands punctuated query tokens into an FTS5 phrase so they match adjacent index tokens", () => {
    const dbPath = join(TEST_DIR, "fts-punctuation.db");
    const indexer = new SearchIndexer(dbPath);

    // The default FTS5 tokenizer splits on punctuation, so "PHP 8.4" lands in
    // the index as three adjacent tokens: PHP, 8, 4.
    indexer.updateIndex({
      id: 1,
      externalId: "target",
      entityType: "issue",
      title: "0035216: PHP 8.4 compatibility",
      content: "Make MantisBT compatible with PHP 8.4.",
      tags: [],
    });

    // Unrelated entity that contains "8" and "4" but not adjacent.
    indexer.updateIndex({
      id: 2,
      externalId: "noise",
      entityType: "issue",
      title: "Something else entirely",
      content: "This doc mentions PHP, and has 4 widgets, and 8 gadgets.",
      tags: [],
    });

    const results = indexer.search("PHP 8.4");
    const titles = results.map((r) => r.externalId);
    expect(titles).toContain("target");
    // The noise doc has PHP + 8 + 4 but not adjacent 8-then-4, so the phrase
    // "8 4*" must not match it.
    expect(titles).not.toContain("noise");

    indexer.close();
  });

  it("honors a limit on search results", () => {
    const dbPath = join(TEST_DIR, "fts-limit.db");
    const indexer = new SearchIndexer(dbPath);

    for (let i = 1; i <= 20; i++) {
      indexer.updateIndex({
        id: i,
        externalId: `ext-${i}`,
        entityType: "issue",
        title: `Bug ${i}: something broke`,
        content: "generic body text about widgets",
        tags: [],
      });
    }

    expect(indexer.search("widgets")).toHaveLength(20);
    expect(indexer.search("widgets", { limit: 5 })).toHaveLength(5);
    // limit: 0 is treated as unset — return everything.
    expect(indexer.search("widgets", { limit: 0 })).toHaveLength(20);

    indexer.close();
  });

  describe("buildFtsQuery", () => {
    it("leaves plain words as prefix matches", () => {
      expect(buildFtsQuery("fix lo")).toBe("fix* lo*");
    });

    it("expands a punctuated token into a phrase with a trailing prefix", () => {
      expect(buildFtsQuery("PHP 8.4")).toBe('PHP* "8 4*"');
      expect(buildFtsQuery("mantis 1.2.3")).toBe('mantis* "1 2 3*"');
    });

    it("returns empty string for whitespace-only input", () => {
      expect(buildFtsQuery("   ")).toBe("");
    });
  });

  it("returns empty array for no matches", () => {
    const dbPath = join(TEST_DIR, "fts-empty.db");
    const indexer = new SearchIndexer(dbPath);

    indexer.updateIndex({
      id: 1,
      externalId: "ext-1",
      entityType: "issue",
      title: "Something",
      content: "Content here",
      tags: [],
    });

    const results = indexer.search("nonexistent");
    expect(results).toHaveLength(0);

    indexer.close();
  });
});
