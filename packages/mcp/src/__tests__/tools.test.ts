import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  entityTags,
  attachments,
  syncRuns,
  SearchIndexer,
} from "@veecontext/core";
import { createMcpServer, type McpServerOptions } from "../server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const TEST_DIR = join(import.meta.dir, ".test-mcp-tools");

let options: McpServerOptions;
let client: Client;

function setupTestEnv() {
  mkdirSync(TEST_DIR, { recursive: true });
  options = { veecontextHome: TEST_DIR };

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
    .insert(attachments)
    .values({
      entityId: data.entityId,
      filename: data.filename,
      mimeType: data.mimeType,
      storagePath: data.storagePath,
      backend: "local",
    })
    .run();

  const attachmentFile = join(
    TEST_DIR,
    "collections",
    collectionName,
    data.storagePath,
  );
  mkdirSync(dirname(attachmentFile), { recursive: true });
  writeFileSync(attachmentFile, data.content);
}

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

describe("collection_list tool", () => {
  it("returns empty array when no collections configured", async () => {
    await setupClient();

    const result = await client.callTool({ name: "collection_list" });
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
    const result = await client.callTool({ name: "collection_list" });
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
    indexer.updateIndex({
      id: entityId,
      externalId: "issue-42",
      entityType: "issue",
      title: "Authentication bug",
      content: "Users cannot login with OAuth",
      tags: ["bug"],
    });
    indexer.close();

    await setupClient();
    const result = await client.callTool({
      name: "entity_search",
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

    const id1 = addEntity(dbPath1, {
      externalId: "e-1",
      entityType: "issue",
      title: "Widget feature",
      data: {},
    });
    const id2 = addEntity(dbPath2, {
      externalId: "e-2",
      entityType: "issue",
      title: "Widget improvement",
      data: {},
    });

    const idx1 = new SearchIndexer(dbPath1);
    idx1.updateIndex({
      id: id1,
      externalId: "e-1",
      entityType: "issue",
      title: "Widget feature",
      content: "Add widgets",
      tags: [],
    });
    idx1.close();

    const idx2 = new SearchIndexer(dbPath2);
    idx2.updateIndex({
      id: id2,
      externalId: "e-2",
      entityType: "issue",
      title: "Widget improvement",
      content: "Better widgets",
      tags: [],
    });
    idx2.close();

    await setupClient();
    const result = await client.callTool({
      name: "entity_search",
      arguments: { query: "widget", collection: "repo-a" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data).toHaveLength(1);
    expect(data[0].collection).toBe("repo-a");
  });
});

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
    const result = await client.callTool({
      name: "entity_get_data",
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

});

describe("entity_get_markdown tool", () => {
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
      name: "entity_get_markdown",
      arguments: { collection: "md-test", externalId: "issue-3" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.markdown).toBe(mdContent);
  });
});

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
      arguments: {
        collection: "attach-col",
        externalId: "commit-1",
        reference: "![[git/abc123/logo.png]]",
      },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(data.filename).toBe("logo.png");
    expect(data.mimeType).toBe("image/png");
    expect(data.resolvedStoragePath).toBe("attachments/git/abc123/logo.png");
    expect(data.contentBase64).toBe(Buffer.from("fake-png-bytes").toString("base64"));
  });
});

describe("MCP resources", () => {
  it("lists all resources including collections", async () => {
    addCollection("res-col-a");
    addCollection("res-col-b");

    await setupClient();
    const result = await client.listResources();

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

    const data = JSON.parse(result.contents[0].text as string);
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

    const data = JSON.parse(result.contents[0].text as string);
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

    const data = JSON.parse(result.contents[0].text as string);
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
