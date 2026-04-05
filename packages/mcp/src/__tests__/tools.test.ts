import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  entityTags,
  syncRuns,
  SearchIndexer,
} from "@veecontext/core";
import { createMcpServer, type McpServerOptions } from "../server";

const TEST_DIR = join(import.meta.dir, ".test-mcp-tools");

let options: McpServerOptions;

function setupTestEnv() {
  mkdirSync(TEST_DIR, { recursive: true });
  options = { veecontextHome: TEST_DIR };

  // Create master DB
  getMasterDb(join(TEST_DIR, "master.db"));
  mkdirSync(join(TEST_DIR, "collections"), { recursive: true });
}

function addCollection(
  name: string,
  opts?: { enabled?: boolean },
): { dbPath: string } {
  const db = getMasterDb(join(TEST_DIR, "master.db"));
  const collectionDir = join(TEST_DIR, "collections", name);
  const dbPath = join(collectionDir, "data.db");
  mkdirSync(collectionDir, { recursive: true });
  mkdirSync(join(collectionDir, "markdown"), { recursive: true });
  getCollectionDb(dbPath);

  db.insert(collections)
    .values({
      name,
      crawlerType: "github",
      config: { owner: "test", repo: name },
      credentials: { token: "tok" },
      enabled: opts?.enabled ?? true,
      dbPath,
    })
    .run();

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
      colDb.insert(entityTags).values({ entityId, tag }).run();
    }
  }

  return entityId;
}

// Helper to call a tool on the MCP server via the internal handler
// We test by constructing the server and inspecting registered tools
// Since McpServer doesn't expose a direct tool-call API for testing,
// we'll test the underlying logic by importing the register functions
// and using a real server instance with a mock transport approach.

// Instead, let's test the tool logic directly by calling the register
// functions and using the server's internal tool map.
// The simplest approach: create the server, then call the tool handlers
// via the server's low-level request handler.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let client: Client;

async function setupClient() {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("list_collections tool", () => {
  it("returns empty array when no collections configured", async () => {
    await setupClient();

    const result = await client.callTool({ name: "list_collections" });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data).toEqual([]);
  });

  it("returns collections with entity counts and sync info", async () => {
    const { dbPath } = addCollection("my-repo");
    const colDb = getCollectionDb(dbPath);

    addEntity(dbPath, {
      externalId: "issue-1",
      entityType: "issue",
      title: "Bug report",
      data: { number: 1 },
    });
    addEntity(dbPath, {
      externalId: "issue-2",
      entityType: "issue",
      title: "Feature request",
      data: { number: 2 },
    });

    colDb
      .insert(syncRuns)
      .values({
        status: "completed",
        entitiesCreated: 2,
        startedAt: "2025-01-15 10:00:00",
        completedAt: "2025-01-15 10:01:00",
      })
      .run();

    await setupClient();
    const result = await client.callTool({ name: "list_collections" });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("my-repo");
    expect(data[0].crawlerType).toBe("github");
    expect(data[0].enabled).toBe(true);
    expect(data[0].entityCount).toBe(2);
    expect(data[0].lastSyncTime).toBe("2025-01-15 10:00:00");
    expect(data[0].lastSyncStatus).toBe("completed");
  });
});

describe("search_entities tool", () => {
  it("returns matching results from FTS index", async () => {
    const { dbPath } = addCollection("search-col");

    addEntity(dbPath, {
      externalId: "issue-42",
      entityType: "issue",
      title: "Authentication bug",
      data: { number: 42, body: "Users cannot login with OAuth" },
    });

    const indexer = new SearchIndexer(dbPath);
    indexer.updateIndex({
      id: 1,
      externalId: "issue-42",
      entityType: "issue",
      title: "Authentication bug",
      content: "Users cannot login with OAuth",
      tags: ["bug"],
    });
    indexer.close();

    await setupClient();
    const result = await client.callTool({
      name: "search_entities",
      arguments: { query: "authentication" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data).toHaveLength(1);
    expect(data[0].externalId).toBe("issue-42");
    expect(data[0].collection).toBe("search-col");
    expect(data[0].title).toBe("Authentication bug");
  });

  it("filters by collection name", async () => {
    const { dbPath: dbPath1 } = addCollection("repo-a");
    const { dbPath: dbPath2 } = addCollection("repo-b");

    addEntity(dbPath1, {
      externalId: "e-1",
      entityType: "issue",
      title: "Widget feature",
      data: {},
    });
    addEntity(dbPath2, {
      externalId: "e-2",
      entityType: "issue",
      title: "Widget improvement",
      data: {},
    });

    const idx1 = new SearchIndexer(dbPath1);
    idx1.updateIndex({
      id: 1,
      externalId: "e-1",
      entityType: "issue",
      title: "Widget feature",
      content: "Add widgets",
      tags: [],
    });
    idx1.close();

    const idx2 = new SearchIndexer(dbPath2);
    idx2.updateIndex({
      id: 1,
      externalId: "e-2",
      entityType: "issue",
      title: "Widget improvement",
      content: "Better widgets",
      tags: [],
    });
    idx2.close();

    await setupClient();
    const result = await client.callTool({
      name: "search_entities",
      arguments: { query: "widget", collection: "repo-a" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data).toHaveLength(1);
    expect(data[0].collection).toBe("repo-a");
  });

  it("filters by entity type", async () => {
    const { dbPath } = addCollection("type-filter");

    addEntity(dbPath, {
      externalId: "issue-1",
      entityType: "issue",
      title: "Bug report",
      data: {},
    });
    addEntity(dbPath, {
      externalId: "pr-1",
      entityType: "pull_request",
      title: "Bug fix PR",
      data: {},
    });

    const indexer = new SearchIndexer(dbPath);
    indexer.updateIndex({
      id: 1,
      externalId: "issue-1",
      entityType: "issue",
      title: "Bug report",
      content: "There is a bug",
      tags: [],
    });
    indexer.updateIndex({
      id: 2,
      externalId: "pr-1",
      entityType: "pull_request",
      title: "Bug fix PR",
      content: "Fixes the bug",
      tags: [],
    });
    indexer.close();

    await setupClient();
    const result = await client.callTool({
      name: "search_entities",
      arguments: { query: "bug", entityType: "issue" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data).toHaveLength(1);
    expect(data[0].entityType).toBe("issue");
  });
});

describe("get_entity tool", () => {
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
    const result = await client.callTool({
      name: "get_entity",
      arguments: { collection: "get-test", externalId: "issue-5" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.externalId).toBe("issue-5");
    expect(data.entityType).toBe("issue");
    expect(data.title).toBe("Important issue");
    expect(data.data.number).toBe(5);
    expect(data.data.state).toBe("open");
    expect(data.url).toBe("https://github.com/test/get-test/issues/5");
    expect(data.tags).toEqual(["bug", "critical"]);
  });

  it("returns rendered markdown when available", async () => {
    const { dbPath } = addCollection("md-test");
    const collectionDir = join(TEST_DIR, "collections", "md-test");
    const mdContent = "# Issue 3\n\nSome content here.";
    const mdPath = "markdown/issues/3-test.md";
    mkdirSync(join(collectionDir, "markdown", "issues"), { recursive: true });
    writeFileSync(join(collectionDir, mdPath), mdContent);

    addEntity(dbPath, {
      externalId: "issue-3",
      entityType: "issue",
      title: "Test issue",
      data: { number: 3 },
      markdownPath: mdPath,
    });

    await setupClient();
    const result = await client.callTool({
      name: "get_entity",
      arguments: { collection: "md-test", externalId: "issue-3" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.markdown).toBe(mdContent);
  });

  it("returns error for non-existent entity", async () => {
    addCollection("empty-col");

    await setupClient();
    const result = await client.callTool({
      name: "get_entity",
      arguments: { collection: "empty-col", externalId: "nope" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.error).toContain("not found");
  });

  it("returns error for non-existent collection", async () => {
    await setupClient();
    const result = await client.callTool({
      name: "get_entity",
      arguments: { collection: "doesnt-exist", externalId: "e-1" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.error).toContain("not found");
  });
});

describe("query_entities tool", () => {
  it("queries entities with default ordering", async () => {
    const { dbPath } = addCollection("query-col");

    addEntity(dbPath, {
      externalId: "issue-1",
      entityType: "issue",
      title: "First issue",
      data: { number: 1 },
    });
    addEntity(dbPath, {
      externalId: "issue-2",
      entityType: "issue",
      title: "Second issue",
      data: { number: 2 },
    });
    addEntity(dbPath, {
      externalId: "pr-1",
      entityType: "pull_request",
      title: "First PR",
      data: { number: 3 },
    });

    await setupClient();
    const result = await client.callTool({
      name: "query_entities",
      arguments: { collection: "query-col" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.entities).toHaveLength(3);
    expect(data.total).toBe(3);
  });

  it("filters by entity type", async () => {
    const { dbPath } = addCollection("filter-type");

    addEntity(dbPath, {
      externalId: "issue-1",
      entityType: "issue",
      title: "Bug",
      data: {},
    });
    addEntity(dbPath, {
      externalId: "pr-1",
      entityType: "pull_request",
      title: "Fix",
      data: {},
    });

    await setupClient();
    const result = await client.callTool({
      name: "query_entities",
      arguments: { collection: "filter-type", entityType: "pull_request" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.entities).toHaveLength(1);
    expect(data.entities[0].entityType).toBe("pull_request");
  });

  it("filters by title substring", async () => {
    const { dbPath } = addCollection("filter-title");

    addEntity(dbPath, {
      externalId: "e-1",
      entityType: "issue",
      title: "Login authentication bug",
      data: {},
    });
    addEntity(dbPath, {
      externalId: "e-2",
      entityType: "issue",
      title: "Dashboard styling",
      data: {},
    });

    await setupClient();
    const result = await client.callTool({
      name: "query_entities",
      arguments: { collection: "filter-title", titleContains: "authentication" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.entities).toHaveLength(1);
    expect(data.entities[0].title).toBe("Login authentication bug");
  });

  it("supports pagination with limit and offset", async () => {
    const { dbPath } = addCollection("paginate");

    for (let i = 1; i <= 5; i++) {
      addEntity(dbPath, {
        externalId: `e-${i}`,
        entityType: "issue",
        title: `Issue ${i}`,
        data: { number: i },
      });
    }

    await setupClient();
    const result = await client.callTool({
      name: "query_entities",
      arguments: {
        collection: "paginate",
        limit: 2,
        offset: 0,
        orderBy: "title",
        orderDirection: "asc",
      },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.entities).toHaveLength(2);
  });

  it("filters by tag", async () => {
    const { dbPath } = addCollection("filter-tag");

    addEntity(dbPath, {
      externalId: "e-1",
      entityType: "issue",
      title: "Tagged issue",
      data: {},
      tags: ["urgent"],
    });
    addEntity(dbPath, {
      externalId: "e-2",
      entityType: "issue",
      title: "Untagged issue",
      data: {},
    });

    await setupClient();
    const result = await client.callTool({
      name: "query_entities",
      arguments: { collection: "filter-tag", tag: "urgent" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.entities).toHaveLength(1);
    expect(data.entities[0].title).toBe("Tagged issue");
  });
});

describe("get_sync_status tool", () => {
  it("returns sync runs for a collection", async () => {
    const { dbPath } = addCollection("sync-status");
    const colDb = getCollectionDb(dbPath);

    colDb
      .insert(syncRuns)
      .values({
        status: "completed",
        entitiesCreated: 5,
        entitiesUpdated: 2,
        entitiesDeleted: 1,
        startedAt: "2025-01-15 10:00:00",
        completedAt: "2025-01-15 10:05:00",
      })
      .run();

    await setupClient();
    const result = await client.callTool({
      name: "get_sync_status",
      arguments: { collection: "sync-status" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.collection).toBe("sync-status");
    expect(data.enabled).toBe(true);
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0].status).toBe("completed");
    expect(data.runs[0].entitiesCreated).toBe(5);
    expect(data.runs[0].entitiesUpdated).toBe(2);
    expect(data.runs[0].entitiesDeleted).toBe(1);
  });

  it("returns error for non-existent collection", async () => {
    await setupClient();
    const result = await client.callTool({
      name: "get_sync_status",
      arguments: { collection: "nope" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.error).toContain("not found");
  });
});

describe("MCP resources", () => {
  it("lists all resources including collections", async () => {
    addCollection("res-col-a");
    addCollection("res-col-b");

    await setupClient();
    const result = await client.listResources();

    // Should have the static collections resource
    const collectionsRes = result.resources.find(
      (r) => r.uri === "veecontext://collections",
    );
    expect(collectionsRes).toBeDefined();
  });

  it("reads the collections static resource", async () => {
    addCollection("read-col");

    await setupClient();
    const result = await client.readResource({
      uri: "veecontext://collections",
    });

    const data = JSON.parse(result.contents[0].text!);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("read-col");
  });

  it("reads a specific collection resource template", async () => {
    const { dbPath } = addCollection("detail-col");
    addEntity(dbPath, {
      externalId: "e-1",
      entityType: "issue",
      title: "Test",
      data: {},
    });

    await setupClient();
    const result = await client.readResource({
      uri: "veecontext://collections/detail-col",
    });

    const data = JSON.parse(result.contents[0].text!);
    expect(data.name).toBe("detail-col");
    expect(data.entityCount).toBe(1);
    expect(data.crawlerType).toBe("github");
  });

  it("reads an entity resource by collection and externalId", async () => {
    const { dbPath } = addCollection("ent-res-col");
    addEntity(dbPath, {
      externalId: "issue-99",
      entityType: "issue",
      title: "Resource entity",
      data: { number: 99 },
      tags: ["test"],
    });

    await setupClient();
    const result = await client.readResource({
      uri: "veecontext://entities/ent-res-col/issue-99",
    });

    const data = JSON.parse(result.contents[0].text!);
    expect(data.externalId).toBe("issue-99");
    expect(data.title).toBe("Resource entity");
    expect(data.tags).toEqual(["test"]);
  });

  it("reads a markdown resource", async () => {
    addCollection("md-res-col");
    const collectionDir = join(TEST_DIR, "collections", "md-res-col");
    mkdirSync(join(collectionDir, "markdown", "issues"), { recursive: true });
    writeFileSync(
      join(collectionDir, "markdown", "issues", "1-test.md"),
      "# Test Issue\n\nBody content.",
    );

    await setupClient();
    const result = await client.readResource({
      uri: "veecontext://markdown/md-res-col/markdown/issues/1-test.md",
    });

    expect(result.contents[0].text).toBe("# Test Issue\n\nBody content.");
    expect(result.contents[0].mimeType).toBe("text/markdown");
  });
});
