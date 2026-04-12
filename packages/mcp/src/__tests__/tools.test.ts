import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  getCollectionDb,
  entities,
  tags,
  entityTags,
  assets,
  syncRuns,
  SearchIndexer,
  addCollection as coreAddCollection,
  saveContext,
} from "@frozenink/core";
import { createMcpServer, type McpServerOptions } from "../server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const TEST_DIR = join(import.meta.dir, ".test-mcp-tools");

let options: McpServerOptions;
let client: Client;

function setupTestEnv() {
  mkdirSync(TEST_DIR, { recursive: true });
  options = { frozeninkHome: TEST_DIR };
  // Required so getFrozenInkHome() / listCollections() / getCollection() etc. resolve to TEST_DIR
  process.env.FROZENINK_HOME = TEST_DIR;

  // Create context.yml (required by contextExists() checks in MCP tools/resources)
  saveContext({ collections: {}, deployments: {} });
  mkdirSync(join(TEST_DIR, "collections"), { recursive: true });
}

function addCollection(
  name: string,
  opts?: { enabled?: boolean },
): { dbPath: string } {
  const collectionDir = join(TEST_DIR, "collections", name);
  const dbPath = join(collectionDir, "db", "data.db");

  mkdirSync(collectionDir, { recursive: true });
  mkdirSync(join(collectionDir, "markdown"), { recursive: true });
  getCollectionDb(dbPath);

  coreAddCollection(name, {
    crawler: "github",
    config: { owner: "test", repo: name },
    credentials: { token: "tok" },
    enabled: opts?.enabled ?? true,
  });

  return { dbPath };
}

function addEntity(
  dbPath: string,
  data: {
    externalId: string;
    entityType: string;
    title: string;
    data: Record<string, unknown>;
    url?: string;
    tags?: string[];
    markdownPath?: string;
  },
): number {
  const colDb = getCollectionDb(dbPath);
  colDb
    .insert(entities)
    .values({
      externalId: data.externalId,
      entityType: data.entityType,
      title: data.title,
      data: data.data,
      url: data.url ?? null,
      markdownPath: data.markdownPath ?? null,
    })
    .run();

  const [row] = colDb
    .select()
    .from(entities)
    .all()
    .filter((e) => e.externalId === data.externalId);

  const entityId = row.id;

  if (data.tags?.length) {
    for (const tag of data.tags) {
      // Insert tag if it doesn't exist, then link to entity
      const existing = colDb.select().from(tags).all().find((t) => t.name === tag);
      let tagId: number;
      if (existing) {
        tagId = existing.id;
      } else {
        colDb.insert(tags).values({ name: tag }).run();
        tagId = colDb.select().from(tags).all().find((t) => t.name === tag)!.id;
      }
      colDb.insert(entityTags).values({ entityId, tagId }).run();
    }
  }

  return entityId;
}

function addAttachment(
  collectionName: string,
  dbPath: string,
  data: {
    entityId: number;
    filename: string;
    mimeType: string;
    storagePath: string;
    content: string;
  },
): void {
  const colDb = getCollectionDb(dbPath);
  colDb
    .insert(assets)
    .values({
      entityId: data.entityId,
      filename: data.filename,
      mimeType: data.mimeType,
      storagePath: data.storagePath,
    })
    .run();

  const attachmentFile = join(TEST_DIR, "collections", collectionName, data.storagePath);
  mkdirSync(dirname(attachmentFile), { recursive: true });
  writeFileSync(attachmentFile, data.content);
}

async function setupClient(overrides?: Partial<McpServerOptions>) {
  const server = createMcpServer({ ...options, ...overrides });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

function parseResult(result: Awaited<ReturnType<typeof client.callTool>>) {
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

// ---------------------------------------------------------------------------
// collection_list tool
// ---------------------------------------------------------------------------

describe("collection_list tool", () => {
  it("returns empty array when no collections configured", async () => {
    await setupClient();

    const result = await client.callTool({ name: "collection_list" });
    const data = parseResult(result);

    expect(data).toEqual([]);
  });

  it("returns collections with entity counts and sync info", async () => {
    const { dbPath } = addCollection("my-repo");
    const colDb = getCollectionDb(dbPath);

    addEntity(dbPath, { externalId: "issue-1", entityType: "issue", title: "Bug report", data: { number: 1 } });
    addEntity(dbPath, { externalId: "issue-2", entityType: "issue", title: "Feature request", data: { number: 2 } });

    colDb.insert(syncRuns).values({ status: "completed", entitiesCreated: 2, startedAt: "2025-01-15 10:00:00", completedAt: "2025-01-15 10:01:00" }).run();

    await setupClient();
    const result = await client.callTool({ name: "collection_list" });
    const data = parseResult(result);

    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("my-repo");
    expect(data[0].crawlerType).toBe("github");
    expect(data[0].enabled).toBe(true);
    expect(data[0].entityCount).toBe(2);
    expect(data[0].lastSyncTime).toBe("2025-01-15 10:00:00");
    expect(data[0].lastSyncStatus).toBe("completed");
  });

  it("returns null lastSyncTime and lastSyncStatus when no sync runs", async () => {
    addCollection("no-sync-col");

    await setupClient();
    const result = await client.callTool({ name: "collection_list" });
    const data = parseResult(result);

    expect(data).toHaveLength(1);
    expect(data[0].lastSyncTime).toBeNull();
    expect(data[0].lastSyncStatus).toBeNull();
  });

  it("lists disabled collections", async () => {
    addCollection("active-col", { enabled: true });
    addCollection("disabled-col", { enabled: false });

    await setupClient();
    const result = await client.callTool({ name: "collection_list" });
    const data = parseResult(result);

    expect(data).toHaveLength(2);
    const disabled = data.find((c: { name: string }) => c.name === "disabled-col");
    expect(disabled.enabled).toBe(false);
  });

  it("respects allowedCollections filter", async () => {
    addCollection("allowed-col");
    addCollection("blocked-col");

    // Two entries keeps multi-collection mode active while still filtering.
    // "nonexistent-col" is not configured so only "allowed-col" comes back.
    await setupClient({ allowedCollections: ["allowed-col", "nonexistent-col"] });

    const result = await client.callTool({ name: "collection_list" });
    const data = parseResult(result);

    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("allowed-col");
  });
});

// ---------------------------------------------------------------------------
// entity_search tool
// ---------------------------------------------------------------------------

describe("entity_search tool", () => {
  it("returns matching results from FTS index", async () => {
    const { dbPath } = addCollection("search-col");

    const entityId = addEntity(dbPath, {
      externalId: "issue-42",
      entityType: "issue",
      title: "Authentication bug",
      data: { number: 42, body: "Users cannot login with OAuth" },
    });

    const indexer = new SearchIndexer(dbPath);
    indexer.updateIndex({ id: entityId, externalId: "issue-42", entityType: "issue", title: "Authentication bug", content: "Users cannot login with OAuth", tags: ["bug"] });
    indexer.close();

    await setupClient();
    const result = await client.callTool({ name: "entity_search", arguments: { query: "authentication" } });
    const data = parseResult(result);

    expect(data).toHaveLength(1);
    expect(data[0].externalId).toBe("issue-42");
    expect(data[0].collection).toBe("search-col");
    expect(data[0].title).toBe("Authentication bug");
  });

  it("filters by collection name", async () => {
    const { dbPath: dbPath1 } = addCollection("repo-a");
    const { dbPath: dbPath2 } = addCollection("repo-b");

    const id1 = addEntity(dbPath1, { externalId: "e-1", entityType: "issue", title: "Widget feature", data: {} });
    const id2 = addEntity(dbPath2, { externalId: "e-2", entityType: "issue", title: "Widget improvement", data: {} });

    const idx1 = new SearchIndexer(dbPath1);
    idx1.updateIndex({ id: id1, externalId: "e-1", entityType: "issue", title: "Widget feature", content: "Add widgets", tags: [] });
    idx1.close();

    const idx2 = new SearchIndexer(dbPath2);
    idx2.updateIndex({ id: id2, externalId: "e-2", entityType: "issue", title: "Widget improvement", content: "Better widgets", tags: [] });
    idx2.close();

    await setupClient();
    const result = await client.callTool({ name: "entity_search", arguments: { query: "widget", collection: "repo-a" } });
    const data = parseResult(result);

    expect(data).toHaveLength(1);
    expect(data[0].collection).toBe("repo-a");
  });

  it("returns results from multiple collections when no collection filter", async () => {
    const { dbPath: dbPath1 } = addCollection("multi-a");
    const { dbPath: dbPath2 } = addCollection("multi-b");

    const id1 = addEntity(dbPath1, { externalId: "e-1", entityType: "issue", title: "Shared topic alpha", data: {} });
    const id2 = addEntity(dbPath2, { externalId: "e-2", entityType: "issue", title: "Shared topic beta", data: {} });

    const idx1 = new SearchIndexer(dbPath1);
    idx1.updateIndex({ id: id1, externalId: "e-1", entityType: "issue", title: "Shared topic alpha", content: "shared content", tags: [] });
    idx1.close();

    const idx2 = new SearchIndexer(dbPath2);
    idx2.updateIndex({ id: id2, externalId: "e-2", entityType: "issue", title: "Shared topic beta", content: "shared content", tags: [] });
    idx2.close();

    await setupClient();
    const result = await client.callTool({ name: "entity_search", arguments: { query: "shared" } });
    const data = parseResult(result);

    expect(data.length).toBeGreaterThanOrEqual(2);
    const collections = data.map((r: { collection: string }) => r.collection);
    expect(collections).toContain("multi-a");
    expect(collections).toContain("multi-b");
  });

  it("returns denied error when collection filter is disallowed", async () => {
    addCollection("private-col");
    addCollection("public-col");

    // Two entries to stay in multi-collection mode.
    await setupClient({ allowedCollections: ["public-col", "other-allowed"] });
    const result = await client.callTool({
      name: "entity_search",
      arguments: { query: "anything", collection: "private-col" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not allowed");
  });

  it("filters by entityType", async () => {
    const { dbPath } = addCollection("typed-col");

    const issueId = addEntity(dbPath, { externalId: "issue-1", entityType: "issue", title: "Login bug", data: {} });
    const prId = addEntity(dbPath, { externalId: "pr-1", entityType: "pull_request", title: "Login fix", data: {} });

    const indexer = new SearchIndexer(dbPath);
    indexer.updateIndex({ id: issueId, externalId: "issue-1", entityType: "issue", title: "Login bug", content: "login problem", tags: [] });
    indexer.updateIndex({ id: prId, externalId: "pr-1", entityType: "pull_request", title: "Login fix", content: "login fix", tags: [] });
    indexer.close();

    await setupClient();
    const result = await client.callTool({
      name: "entity_search",
      arguments: { query: "login", entityType: "issue" },
    });
    const data = parseResult(result);

    expect(data.every((r: { entityType: string }) => r.entityType === "issue")).toBe(true);
  });

  it("respects limit parameter", async () => {
    const { dbPath } = addCollection("limit-col");

    const indexer = new SearchIndexer(dbPath);
    for (let i = 1; i <= 10; i++) {
      const id = addEntity(dbPath, { externalId: `issue-${i}`, entityType: "issue", title: `Pagination item ${i}`, data: {} });
      indexer.updateIndex({ id, externalId: `issue-${i}`, entityType: "issue", title: `Pagination item ${i}`, content: "paginate results", tags: [] });
    }
    indexer.close();

    await setupClient();
    const result = await client.callTool({
      name: "entity_search",
      arguments: { query: "paginate", limit: 3 },
    });
    const data = parseResult(result);

    expect(data).toHaveLength(3);
  });

  it("returns empty array when collection DB does not exist", async () => {
    // Register collection in context but do not create the DB
    coreAddCollection("ghost-col", {
      crawler: "github",
      config: { owner: "test", repo: "ghost-col" },
      credentials: { token: "tok" },
      enabled: true,
    });

    await setupClient();
    const result = await client.callTool({
      name: "entity_search",
      arguments: { query: "anything", collection: "ghost-col" },
    });
    const data = parseResult(result);

    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// entity_get_data tool
// ---------------------------------------------------------------------------

describe("entity_get_data tool", () => {
  it("returns full entity data with tags", async () => {
    const { dbPath } = addCollection("get-test");

    addEntity(dbPath, {
      externalId: "issue-5",
      entityType: "issue",
      title: "Important issue",
      data: { number: 5, state: "open" },
      url: "https://github.com/test/get-test/issues/5",
      tags: ["bug", "critical"],
    });

    await setupClient();
    const result = await client.callTool({ name: "entity_get_data", arguments: { collection: "get-test", externalId: "issue-5" } });
    const data = parseResult(result);

    expect(data.externalId).toBe("issue-5");
    expect(data.entityType).toBe("issue");
    expect(data.title).toBe("Important issue");
    expect(data.data.number).toBe(5);
    expect(data.data.state).toBe("open");
    expect(data.url).toBe("https://github.com/test/get-test/issues/5");
    expect(data.tags).toEqual(["bug", "critical"]);
  });

  it("includes markdown content when markdownPath exists on disk", async () => {
    const { dbPath } = addCollection("with-md");
    const collectionDir = join(TEST_DIR, "collections", "with-md");
    const mdContent = "# Issue 7\n\nBody here.";
    const mdPath = "markdown/issues/7-test.md";

    mkdirSync(join(collectionDir, "markdown", "issues"), { recursive: true });
    writeFileSync(join(collectionDir, mdPath), mdContent);

    addEntity(dbPath, {
      externalId: "issue-7",
      entityType: "issue",
      title: "Issue with markdown",
      data: {},
      markdownPath: mdPath,
    });

    await setupClient();
    const result = await client.callTool({ name: "entity_get_data", arguments: { collection: "with-md", externalId: "issue-7" } });
    const data = parseResult(result);

    expect(data.markdown).toBe(mdContent);
  });

  it("returns null markdown when markdownPath is set but file is missing", async () => {
    const { dbPath } = addCollection("missing-md");

    addEntity(dbPath, {
      externalId: "issue-8",
      entityType: "issue",
      title: "Issue missing markdown file",
      data: {},
      markdownPath: "markdown/issues/8-missing.md",
    });

    await setupClient();
    const result = await client.callTool({ name: "entity_get_data", arguments: { collection: "missing-md", externalId: "issue-8" } });
    const data = parseResult(result);

    expect(data.externalId).toBe("issue-8");
    expect(data.markdown).toBeNull();
  });

  it("returns error when entity is not found", async () => {
    addCollection("empty-col");

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_data",
      arguments: { collection: "empty-col", externalId: "nonexistent" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not found");
  });

  it("returns error when collection is not found", async () => {
    await setupClient();
    const result = await client.callTool({
      name: "entity_get_data",
      arguments: { collection: "does-not-exist", externalId: "issue-1" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not found");
  });

  it("denies access to disallowed collection", async () => {
    const { dbPath } = addCollection("private-col");
    addEntity(dbPath, {
      externalId: "issue-1",
      entityType: "issue",
      title: "Hidden issue",
      data: {},
    });

    // Two entries to stay in multi-collection mode.
    await setupClient({ allowedCollections: ["other-col", "another-col"] });
    const result = await client.callTool({
      name: "entity_get_data",
      arguments: { collection: "private-col", externalId: "issue-1" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not allowed");
  });
});

// ---------------------------------------------------------------------------
// entity_get_markdown tool
// ---------------------------------------------------------------------------

describe("entity_get_markdown tool", () => {
  it("returns rendered markdown when available", async () => {
    const { dbPath } = addCollection("md-test");
    const collectionDir = join(TEST_DIR, "collections", "md-test");
    const mdContent = "# Issue 3\n\nSome content here.";
    const mdPath = "markdown/issues/3-test.md";

    mkdirSync(join(collectionDir, "markdown", "issues"), { recursive: true });
    writeFileSync(join(collectionDir, mdPath), mdContent);

    addEntity(dbPath, { externalId: "issue-3", entityType: "issue", title: "Test issue", data: { number: 3 }, markdownPath: mdPath });

    await setupClient();
    const result = await client.callTool({ name: "entity_get_markdown", arguments: { collection: "md-test", externalId: "issue-3" } });
    const data = parseResult(result);

    expect(data.markdown).toBe(mdContent);
  });

  it("denies access to disallowed collection", async () => {
    const { dbPath } = addCollection("locked-col");
    addEntity(dbPath, { externalId: "issue-1", entityType: "issue", title: "Hidden", data: {}, markdownPath: "markdown/1.md" });

    // Two entries to stay in multi-collection mode.
    await setupClient({ allowedCollections: ["other-col", "another-col"] });
    const result = await client.callTool({
      name: "entity_get_markdown",
      arguments: { collection: "locked-col", externalId: "issue-1" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not allowed");
  });

  it("returns error when entity is not found", async () => {
    addCollection("md-empty");

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_markdown",
      arguments: { collection: "md-empty", externalId: "nonexistent" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not found");
  });

  it("returns error when entity has no markdownPath", async () => {
    const { dbPath } = addCollection("no-md-col");
    addEntity(dbPath, { externalId: "issue-10", entityType: "issue", title: "No markdown", data: {} });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_markdown",
      arguments: { collection: "no-md-col", externalId: "issue-10" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("no rendered markdown");
  });

  it("returns error when markdown file is missing on disk", async () => {
    const { dbPath } = addCollection("ghost-md-col");
    addEntity(dbPath, {
      externalId: "issue-11",
      entityType: "issue",
      title: "Missing file",
      data: {},
      markdownPath: "markdown/issues/11-missing.md",
    });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_markdown",
      arguments: { collection: "ghost-md-col", externalId: "issue-11" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// entity_get_attachment tool
// ---------------------------------------------------------------------------

describe("entity_get_attachment tool", () => {
  it("returns base64 content for wiki-style reference", async () => {
    const { dbPath } = addCollection("attach-col");
    const entityId = addEntity(dbPath, {
      externalId: "commit-1",
      entityType: "commit",
      title: "Commit with image",
      data: {},
      markdownPath: "markdown/commits/commit-1.md",
    });

    addAttachment("attach-col", dbPath, {
      entityId,
      filename: "logo.png",
      mimeType: "image/png",
      storagePath: "attachments/git/abc123/logo.png",
      content: "fake-png-bytes",
    });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: { collection: "attach-col", externalId: "commit-1", reference: "![[git/abc123/logo.png]]" },
    });
    const data = parseResult(result);

    expect(data.filename).toBe("logo.png");
    expect(data.mimeType).toBe("image/png");
    expect(data.resolvedStoragePath).toBe("attachments/git/abc123/logo.png");
    expect(data.contentBase64).toBe(Buffer.from("fake-png-bytes").toString("base64"));
  }, 15000);

  it("resolves standard markdown image syntax", async () => {
    const { dbPath } = addCollection("md-attach-col");
    const entityId = addEntity(dbPath, {
      externalId: "issue-20",
      entityType: "issue",
      title: "Issue with diagram",
      data: {},
      markdownPath: "markdown/issues/20.md",
    });

    addAttachment("md-attach-col", dbPath, {
      entityId,
      filename: "diagram.png",
      mimeType: "image/png",
      storagePath: "attachments/git/def456/diagram.png",
      content: "fake-diagram-bytes",
    });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: {
        collection: "md-attach-col",
        externalId: "issue-20",
        reference: "![diagram](../../attachments/git/def456/diagram.png)",
      },
    });
    const data = parseResult(result);

    expect(data.filename).toBe("diagram.png");
    expect(data.contentBase64).toBe(Buffer.from("fake-diagram-bytes").toString("base64"));
  });

  it("resolves attachment via externalId relative path", async () => {
    const { dbPath } = addCollection("rel-attach-col");
    const entityId = addEntity(dbPath, {
      externalId: "commit-rel",
      entityType: "commit",
      title: "Commit with relative image",
      data: {},
      markdownPath: "markdown/commits/commit-rel.md",
    });

    addAttachment("rel-attach-col", dbPath, {
      entityId,
      filename: "screenshot.png",
      mimeType: "image/png",
      storagePath: "attachments/git/xyz/screenshot.png",
      content: "screenshot-data",
    });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: {
        collection: "rel-attach-col",
        externalId: "commit-rel",
        reference: "screenshot.png",
      },
    });
    const data = parseResult(result);

    expect(data.filename).toBe("screenshot.png");
    expect(data.sizeBytes).toBe(Buffer.from("screenshot-data").length);
  });

  it("denies access to disallowed collection", async () => {
    addCollection("private-attach-col");

    // Two entries to stay in multi-collection mode.
    await setupClient({ allowedCollections: ["other-col", "another-col"] });
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: { collection: "private-attach-col", reference: "![[some/file.png]]" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not allowed");
  });

  it("returns error when entity externalId is not found", async () => {
    addCollection("attach-missing-entity");

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: {
        collection: "attach-missing-entity",
        externalId: "nonexistent",
        reference: "![[some/file.png]]",
      },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not found");
  });

  it("returns error when attachment is not in DB", async () => {
    const { dbPath } = addCollection("no-attach-col");
    addEntity(dbPath, { externalId: "issue-30", entityType: "issue", title: "No attachment", data: {} });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: {
        collection: "no-attach-col",
        reference: "![[missing/file.png]]",
      },
    });
    const data = parseResult(result);

    expect(data.error).toContain("Attachment not found");
    expect(data.candidates).toBeDefined();
  });

  it("returns error when attachment file is in DB but missing on disk", async () => {
    const { dbPath } = addCollection("disk-missing-col");
    const entityId = addEntity(dbPath, {
      externalId: "commit-2",
      entityType: "commit",
      title: "Commit missing file",
      data: {},
    });

    // Insert DB record but do NOT write the file to disk
    const colDb = getCollectionDb(dbPath);
    colDb.insert(assets).values({
      entityId,
      filename: "ghost.png",
      mimeType: "image/png",
      storagePath: "attachments/git/zzz/ghost.png",
    }).run();

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: {
        collection: "disk-missing-col",
        reference: "![[git/zzz/ghost.png]]",
      },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not found on disk");
  });

  it("rejects HTTP reference as not a local path", async () => {
    addCollection("http-ref-col");

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: {
        collection: "http-ref-col",
        reference: "![image](https://example.com/image.png)",
      },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not a local attachment path");
  });
});

// ---------------------------------------------------------------------------
// MCP resources
// ---------------------------------------------------------------------------

describe("MCP resources", () => {
  it("lists all resources including collections", async () => {
    addCollection("res-col-a");
    addCollection("res-col-b");

    await setupClient();
    const result = await client.listResources();

    const collectionsRes = result.resources.find((r) => r.uri === "frozenink://collections");
    expect(collectionsRes).toBeDefined();
  });

  it("reads the collections static resource", async () => {
    addCollection("read-col");

    await setupClient();
    const result = await client.readResource({ uri: "frozenink://collections" });

    const data = JSON.parse(result.contents[0].text as string);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("read-col");
  });

  it("reads a specific collection resource template", async () => {
    const { dbPath } = addCollection("detail-col");
    addEntity(dbPath, { externalId: "e-1", entityType: "issue", title: "Test", data: {} });

    await setupClient();
    const result = await client.readResource({ uri: "frozenink://collections/detail-col" });

    const data = JSON.parse(result.contents[0].text as string);
    expect(data.name).toBe("detail-col");
    expect(data.entityCount).toBe(1);
    expect(data.crawlerType).toBe("github");
  });

  it("reads an entity resource by collection and externalId", async () => {
    const { dbPath } = addCollection("ent-res-col");
    addEntity(dbPath, { externalId: "issue-99", entityType: "issue", title: "Resource entity", data: { number: 99 }, tags: ["test"] });

    await setupClient();
    const result = await client.readResource({ uri: "frozenink://entities/ent-res-col/issue-99" });

    const data = JSON.parse(result.contents[0].text as string);
    expect(data.externalId).toBe("issue-99");
    expect(data.title).toBe("Resource entity");
    expect(data.tags).toEqual(["test"]);
  });

  it("reads a markdown resource", async () => {
    addCollection("md-res-col");
    const collectionDir = join(TEST_DIR, "collections", "md-res-col");

    mkdirSync(join(collectionDir, "markdown", "issues"), { recursive: true });
    writeFileSync(join(collectionDir, "markdown", "issues", "1-test.md"), "# Test Issue\n\nBody content.");

    await setupClient();
    const result = await client.readResource({ uri: "frozenink://markdown/md-res-col/markdown/issues/1-test.md" });

    expect(result.contents[0].text).toBe("# Test Issue\n\nBody content.");
    expect(result.contents[0].mimeType).toBe("text/markdown");
  });

  it("filters collection resources by allowlist", async () => {
    addCollection("allow-one");
    addCollection("allow-two");

    // Two entries to stay in multi-collection mode while still filtering.
    await setupClient({ allowedCollections: ["allow-one", "nonexistent-col"] });
    const result = await client.readResource({ uri: "frozenink://collections" });
    const data = JSON.parse(result.contents[0].text as string);

    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("allow-one");
  });

  it("returns error for entity resource with non-existent entity", async () => {
    addCollection("ent-missing-col");

    await setupClient();
    const result = await client.readResource({ uri: "frozenink://entities/ent-missing-col/nonexistent-id" });

    const data = JSON.parse(result.contents[0].text as string);
    expect(data.error).toContain("not found");
  });

  it("returns error for entity resource with disallowed collection", async () => {
    addCollection("blocked-ent-col");

    await setupClient({ allowedCollections: ["other-col"] });
    const result = await client.readResource({ uri: "frozenink://entities/blocked-ent-col/issue-1" });

    const data = JSON.parse(result.contents[0].text as string);
    expect(data.error).toContain("not allowed");
  });

  it("returns error for markdown resource when file is missing", async () => {
    addCollection("md-missing-res-col");

    await setupClient();
    const result = await client.readResource({ uri: "frozenink://markdown/md-missing-res-col/markdown/issues/99-missing.md" });

    expect(result.contents[0].text).toContain("not found");
  });

  it("returns error for markdown resource with disallowed collection", async () => {
    addCollection("blocked-md-col");

    await setupClient({ allowedCollections: ["other-col"] });
    const result = await client.readResource({ uri: "frozenink://markdown/blocked-md-col/markdown/issues/1.md" });

    expect(result.contents[0].text).toContain("not allowed");
  });
});

// ---------------------------------------------------------------------------
// Single-collection mode
// ---------------------------------------------------------------------------

describe("single-collection mode (allowedCollections with one entry)", () => {
  it("does not register collection_list tool", async () => {
    addCollection("solo-col");

    await setupClient({ allowedCollections: ["solo-col"] });
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);

    expect(names).not.toContain("collection_list");
  });

  it("entity_search has no collection parameter in schema", async () => {
    addCollection("solo-search");

    await setupClient({ allowedCollections: ["solo-search"] });
    const tools = await client.listTools();
    const searchTool = tools.tools.find((t) => t.name === "entity_search");

    expect(searchTool).toBeDefined();
    expect(searchTool!.inputSchema.properties).not.toHaveProperty("collection");
  });

  it("entity_get_data has no collection parameter in schema", async () => {
    addCollection("solo-get");

    await setupClient({ allowedCollections: ["solo-get"] });
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "entity_get_data");

    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).not.toHaveProperty("collection");
  });

  it("entity_get_markdown has no collection parameter in schema", async () => {
    addCollection("solo-md-schema");

    await setupClient({ allowedCollections: ["solo-md-schema"] });
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "entity_get_markdown");

    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).not.toHaveProperty("collection");
  });

  it("entity_get_attachment has no collection parameter in schema", async () => {
    addCollection("solo-attach-schema");

    await setupClient({ allowedCollections: ["solo-attach-schema"] });
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "entity_get_attachment");

    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).not.toHaveProperty("collection");
  });

  it("entity_search works without collection parameter", async () => {
    const { dbPath } = addCollection("solo-search-col");

    const id = addEntity(dbPath, {
      externalId: "issue-solo",
      entityType: "issue",
      title: "Solo search result",
      data: {},
    });

    const indexer = new SearchIndexer(dbPath);
    indexer.updateIndex({ id, externalId: "issue-solo", entityType: "issue", title: "Solo search result", content: "solo content", tags: [] });
    indexer.close();

    await setupClient({ allowedCollections: ["solo-search-col"] });
    const result = await client.callTool({
      name: "entity_search",
      arguments: { query: "solo" },
    });
    const data = parseResult(result);

    expect(data).toHaveLength(1);
    expect(data[0].externalId).toBe("issue-solo");
    expect(data[0].collection).toBe("solo-search-col");
  });

  it("entity_get_data works without collection parameter", async () => {
    const { dbPath } = addCollection("solo-get-col");
    addEntity(dbPath, {
      externalId: "issue-solo-get",
      entityType: "issue",
      title: "Solo entity",
      data: { number: 1 },
      tags: ["solo"],
    });

    await setupClient({ allowedCollections: ["solo-get-col"] });
    const result = await client.callTool({
      name: "entity_get_data",
      arguments: { externalId: "issue-solo-get" },
    });
    const data = parseResult(result);

    expect(data.externalId).toBe("issue-solo-get");
    expect(data.title).toBe("Solo entity");
    expect(data.tags).toEqual(["solo"]);
  });

  it("entity_get_markdown works without collection parameter", async () => {
    const { dbPath } = addCollection("solo-md-col");
    const collectionDir = join(TEST_DIR, "collections", "solo-md-col");
    const mdContent = "# Solo Issue\n\nContent.";
    const mdPath = "markdown/issues/solo.md";

    mkdirSync(join(collectionDir, "markdown", "issues"), { recursive: true });
    writeFileSync(join(collectionDir, mdPath), mdContent);

    addEntity(dbPath, {
      externalId: "issue-solo-md",
      entityType: "issue",
      title: "Solo markdown",
      data: {},
      markdownPath: mdPath,
    });

    await setupClient({ allowedCollections: ["solo-md-col"] });
    const result = await client.callTool({
      name: "entity_get_markdown",
      arguments: { externalId: "issue-solo-md" },
    });
    const data = parseResult(result);

    expect(data.markdown).toBe(mdContent);
  });

  it("entity_get_attachment works without collection parameter", async () => {
    const { dbPath } = addCollection("solo-attach-col");
    const entityId = addEntity(dbPath, {
      externalId: "commit-solo",
      entityType: "commit",
      title: "Solo attachment",
      data: {},
    });

    addAttachment("solo-attach-col", dbPath, {
      entityId,
      filename: "solo.png",
      mimeType: "image/png",
      storagePath: "attachments/git/solo/solo.png",
      content: "solo-bytes",
    });

    await setupClient({ allowedCollections: ["solo-attach-col"] });
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: { reference: "![[git/solo/solo.png]]" },
    });
    const data = parseResult(result);

    expect(data.filename).toBe("solo.png");
    expect(data.contentBase64).toBe(Buffer.from("solo-bytes").toString("base64"));
  });
});

// ---------------------------------------------------------------------------
// Multi-collection mode: optional collection (search all when omitted)
// ---------------------------------------------------------------------------

describe("multi-collection mode: optional collection parameter", () => {
  it("entity_get_data has optional collection in schema", async () => {
    await setupClient();
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "entity_get_data");

    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).toHaveProperty("collection");
    // collection must not be in required list
    const required: string[] = (tool!.inputSchema as any).required ?? [];
    expect(required).not.toContain("collection");
  });

  it("entity_get_markdown has optional collection in schema", async () => {
    await setupClient();
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "entity_get_markdown");

    expect(tool).toBeDefined();
    const required: string[] = (tool!.inputSchema as any).required ?? [];
    expect(required).not.toContain("collection");
  });

  it("entity_get_attachment has optional collection in schema", async () => {
    await setupClient();
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "entity_get_attachment");

    expect(tool).toBeDefined();
    const required: string[] = (tool!.inputSchema as any).required ?? [];
    expect(required).not.toContain("collection");
  });

  it("entity_get_data finds entity across collections when collection is omitted", async () => {
    const { dbPath: dbPath1 } = addCollection("multi-find-a");
    const { dbPath: dbPath2 } = addCollection("multi-find-b");

    addEntity(dbPath1, { externalId: "shared-issue", entityType: "issue", title: "In collection A", data: {} });
    addEntity(dbPath2, { externalId: "other-issue", entityType: "issue", title: "In collection B", data: {} });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_data",
      arguments: { externalId: "shared-issue" },
    });
    const data = parseResult(result);

    expect(data.externalId).toBe("shared-issue");
    expect(data.collection).toBe("multi-find-a");
    expect(data.title).toBe("In collection A");
  });

  it("entity_get_data returns error when entity not found in any collection", async () => {
    addCollection("no-match-a");
    addCollection("no-match-b");

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_data",
      arguments: { externalId: "does-not-exist" },
    });
    const data = parseResult(result);

    expect(data.error).toContain("not found");
    expect(data.error).toContain("any collection");
  });

  it("entity_get_markdown finds entity across collections when collection is omitted", async () => {
    const { dbPath: dbPath1 } = addCollection("md-multi-a");
    const { dbPath: dbPath2 } = addCollection("md-multi-b");
    const collectionDirB = join(TEST_DIR, "collections", "md-multi-b");
    const mdContent = "# Found in B";
    const mdPath = "markdown/issues/found-b.md";

    // Entity only exists in collection B with markdown
    addEntity(dbPath1, { externalId: "other-entity", entityType: "issue", title: "Other", data: {} });
    mkdirSync(join(collectionDirB, "markdown", "issues"), { recursive: true });
    writeFileSync(join(collectionDirB, mdPath), mdContent);
    addEntity(dbPath2, { externalId: "cross-md-entity", entityType: "issue", title: "Found", data: {}, markdownPath: mdPath });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_markdown",
      arguments: { externalId: "cross-md-entity" },
    });
    const data = parseResult(result);

    expect(data.markdown).toBe(mdContent);
    expect(data.collection).toBe("md-multi-b");
  });

  it("entity_get_attachment finds attachment across collections when collection is omitted", async () => {
    const { dbPath: dbPath1 } = addCollection("att-multi-a");
    const { dbPath: dbPath2 } = addCollection("att-multi-b");

    // Attachment only exists in collection B
    addEntity(dbPath1, { externalId: "other-commit", entityType: "commit", title: "Other", data: {} });
    const entityId = addEntity(dbPath2, { externalId: "cross-commit", entityType: "commit", title: "With attachment", data: {} });
    addAttachment("att-multi-b", dbPath2, {
      entityId,
      filename: "cross.png",
      mimeType: "image/png",
      storagePath: "attachments/git/cross/cross.png",
      content: "cross-bytes",
    });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_attachment",
      arguments: { reference: "![[git/cross/cross.png]]" },
    });
    const data = parseResult(result);

    expect(data.filename).toBe("cross.png");
    expect(data.collection).toBe("att-multi-b");
    expect(data.contentBase64).toBe(Buffer.from("cross-bytes").toString("base64"));
  });

  it("entity_get_data includes collection name in response", async () => {
    const { dbPath } = addCollection("named-col");
    addEntity(dbPath, { externalId: "issue-named", entityType: "issue", title: "Named", data: {} });

    await setupClient();
    const result = await client.callTool({
      name: "entity_get_data",
      arguments: { collection: "named-col", externalId: "issue-named" },
    });
    const data = parseResult(result);

    expect(data.collection).toBe("named-col");
  });
});
