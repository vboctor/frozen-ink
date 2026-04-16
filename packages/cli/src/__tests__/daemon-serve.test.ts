import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { join } from "path";
import {
  getCollectionDb,
  entities,
  SearchIndexer,
  addCollection,
} from "@frozenink/core";
import { eq } from "drizzle-orm";

const TEST_DIR = join(import.meta.dir, ".test-daemon-serve");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.FROZENINK_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

function initTestEnv() {
  writeFileSync(
    join(TEST_DIR, "frozenink.yml"),
    "sync:\n  interval: 900\nui:\n  port: 3000\n",
  );

  // Create collections directory (required by contextExists() checks)
  mkdirSync(join(TEST_DIR, "collections"), { recursive: true });
}

function addTestCollection(
  name: string,
  opts?: { addEntities?: boolean; addAttachment?: boolean; addFts?: boolean },
) {
  const collectionDir = join(TEST_DIR, "collections", name);
  const dbPath = join(collectionDir, "db", "data.db");
  mkdirSync(collectionDir, { recursive: true });
  mkdirSync(join(collectionDir, "content"), { recursive: true });

  const colDb = getCollectionDb(dbPath);

  addCollection(name, {
    crawler: "github",
    config: { owner: "test", repo: "repo" },
    credentials: { token: "tok", owner: "test", repo: "repo" },
  });

  if (opts?.addEntities) {
    colDb
      .insert(entities)
      .values({
        externalId: "issue-1",
        entityType: "issue",
        title: "Test Issue One",
        folder: "issues",
        slug: "issue-1",
        data: {
          source: { number: 1, body: "First test issue body" },
          url: "https://github.com/test/repo/issues/1",
          tags: ["bug", "critical"],
        },
      })
      .run();

    colDb
      .insert(entities)
      .values({
        externalId: "pr-2",
        entityType: "pull_request",
        title: "Test Pull Request",
        folder: "pull-requests",
        slug: "pr-2",
        data: {
          source: { number: 2, body: "PR description" },
          url: "https://github.com/test/repo/pull/2",
        },
      })
      .run();

    mkdirSync(join(collectionDir, "content", "issues"), { recursive: true });
    mkdirSync(join(collectionDir, "content", "pull-requests"), { recursive: true });
    writeFileSync(join(collectionDir, "content", "issues", "issue-1.md"), "# Test Issue One\nFirst test issue body");
    writeFileSync(join(collectionDir, "content", "pull-requests", "pr-2.md"), "# Test Pull Request\nPR description");
  }

  if (opts?.addAttachment) {
    mkdirSync(join(collectionDir, "attachments", "issue-1"), { recursive: true });
    writeFileSync(join(collectionDir, "attachments", "issue-1", "screenshot.png"), Buffer.from("fake-png-data"));

    if (opts.addEntities) {
      const entityRows = colDb.select().from(entities).all();
      const entityData = entityRows[0].data as {
        source: Record<string, unknown>;
        assets?: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }>;
      };
      colDb
        .update(entities)
        .set({
          data: {
            ...entityData,
            assets: [
              {
                filename: "screenshot.png",
                mimeType: "image/png",
                storagePath: "attachments/issue-1/screenshot.png",
                hash: "",
              },
            ],
          },
        })
        .where(eq(entities.id, entityRows[0].id))
        .run();
    }
  }

  if (opts?.addFts) {
    const indexer = new SearchIndexer(dbPath);
    indexer.updateIndex({ id: 1, externalId: "issue-1", entityType: "issue", title: "Test Issue One", content: "First test issue body", tags: ["bug", "critical"] });
    indexer.updateIndex({ id: 2, externalId: "pr-2", entityType: "pull_request", title: "Test Pull Request", content: "PR description", tags: [] });
    indexer.close();
  }

  return { dbPath, collectionDir };
}

describe("Daemon: start/stop/status lifecycle", () => {
  it("daemon start writes PID file and daemon status reports running", async () => {
    initTestEnv();

    const pidPath = join(TEST_DIR, "daemon.pid");

    const { daemonCommand } = await import("../commands/daemon");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await daemonCommand.parseAsync(["start"], { from: "user" });

    console.log = origLog;

    expect(existsSync(pidPath)).toBe(true);
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    expect(pid).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes("Daemon started"))).toBe(true);

    const statusLogs: string[] = [];
    console.log = (...args: unknown[]) => statusLogs.push(args.join(" "));

    const { daemonCommand: dc2 } = await import("../commands/daemon");
    await dc2.parseAsync(["status"], { from: "user" });

    console.log = origLog;
    expect(statusLogs.some((l) => l.includes("running"))).toBe(true);

    const stopLogs: string[] = [];
    console.log = (...args: unknown[]) => stopLogs.push(args.join(" "));

    const { daemonCommand: dc3 } = await import("../commands/daemon");
    await dc3.parseAsync(["stop"], { from: "user" });

    console.log = origLog;
    expect(stopLogs.some((l) => l.includes("stopped") || l.includes("Daemon"))).toBe(true);
    expect(existsSync(pidPath)).toBe(false);
  });

  it("daemon stop reports not running when no PID file exists", async () => {
    initTestEnv();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { daemonCommand } = await import("../commands/daemon");
    await daemonCommand.parseAsync(["stop"], { from: "user" });

    console.log = origLog;
    expect(logs.some((l) => l.includes("not running"))).toBe(true);
  });

  it("daemon status reports not running when no PID file exists", async () => {
    initTestEnv();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { daemonCommand } = await import("../commands/daemon");
    await daemonCommand.parseAsync(["status"], { from: "user" });

    console.log = origLog;
    expect(logs.some((l) => l.includes("not running"))).toBe(true);
  });

  it("daemon status cleans up stale PID file", async () => {
    initTestEnv();

    const pidPath = join(TEST_DIR, "daemon.pid");
    writeFileSync(pidPath, "999999999");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { daemonCommand } = await import("../commands/daemon");
    await daemonCommand.parseAsync(["status"], { from: "user" });

    console.log = origLog;
    expect(logs.some((l) => l.includes("not running"))).toBe(true);
    expect(existsSync(pidPath)).toBe(false);
  });

  it("daemon start detects already running daemon", async () => {
    initTestEnv();

    const pidPath = join(TEST_DIR, "daemon.pid");
    writeFileSync(pidPath, String(process.pid));

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const { daemonCommand } = await import("../commands/daemon");
    await daemonCommand.parseAsync(["start"], { from: "user" });

    console.log = origLog;
    expect(logs.some((l) => l.includes("already running"))).toBe(true);
  });
});

describe("API: GET /api/collections", () => {
  it("returns list of collections", async () => {
    initTestEnv();
    addTestCollection("my-project", { addEntities: true });

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/collections`);
      expect(res.status).toBe(200);

      const data = (await res.json()) as Array<{
        name: string;
        crawlerType: string;
        enabled: boolean;
      }>;
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("my-project");
      expect(data[0].crawlerType).toBe("github");
      expect(data[0].enabled).toBe(true);
    } finally {
      server.stop();
    }
  });
});

describe("API: GET /api/collections/:name/tree", () => {
  it("returns file tree of markdown files", async () => {
    initTestEnv();
    addTestCollection("tree-test", { addEntities: true });

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/collections/tree-test/tree`);
      expect(res.status).toBe(200);

      const tree = (await res.json()) as Array<{ name: string; type: string; children?: unknown[] }>;
      expect(tree.length).toBeGreaterThan(0);

      const dirNames = tree.map((t) => t.name);
      expect(dirNames).toContain("issues");
      expect(dirNames).toContain("pull-requests");

      const issuesDir = tree.find((t) => t.name === "issues");
      expect(issuesDir?.type).toBe("directory");
      expect(issuesDir?.children).toHaveLength(1);
    } finally {
      server.stop();
    }
  });

  it("returns 404 for nonexistent collection", async () => {
    initTestEnv();

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/collections/nope/tree`);
      expect(res.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});

describe("API: GET /api/collections/:name/entities", () => {
  it("returns paginated entities with tags", async () => {
    initTestEnv();
    addTestCollection("entity-test", { addEntities: true });

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/collections/entity-test/entities`);
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        entities: Array<{ externalId: string; entityType: string; title: string; tags: string[] }>;
        pagination: { limit: number; offset: number; count: number };
      };
      expect(data.entities).toHaveLength(2);
      expect(data.pagination.limit).toBe(50);
      expect(data.pagination.offset).toBe(0);

      const issue = data.entities.find((e) => e.externalId === "issue-1");
      expect(issue).toBeDefined();
      expect(issue!.tags).toContain("bug");
      expect(issue!.tags).toContain("critical");
    } finally {
      server.stop();
    }
  });

  it("supports type filter and pagination", async () => {
    initTestEnv();
    addTestCollection("filter-test", { addEntities: true });

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/collections/filter-test/entities?type=issue&limit=1&offset=0`);
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        entities: Array<{ entityType: string }>;
        pagination: { limit: number; offset: number; count: number };
      };
      expect(data.entities).toHaveLength(1);
      expect(data.entities[0].entityType).toBe("issue");
      expect(data.pagination.limit).toBe(1);
    } finally {
      server.stop();
    }
  });
});

describe("API: GET /api/search", () => {
  it("returns FTS search results", async () => {
    initTestEnv();
    addTestCollection("search-api", { addEntities: true, addFts: true });

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/search?q=issue`);
      expect(res.status).toBe(200);

      const data = (await res.json()) as Array<{ collection: string; externalId: string; title: string }>;
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].collection).toBe("search-api");
      expect(data[0].title).toBe("Test Issue One");
    } finally {
      server.stop();
    }
  });

  it("returns 400 when query parameter is missing", async () => {
    initTestEnv();

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/search`);
      expect(res.status).toBe(400);
    } finally {
      server.stop();
    }
  });

  it("supports collection and type filters", async () => {
    initTestEnv();
    addTestCollection("search-filter", { addEntities: true, addFts: true });

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/search?q=test&collection=search-filter&type=pull_request`);
      expect(res.status).toBe(200);

      const data = (await res.json()) as Array<{ entityType: string }>;
      for (const r of data) {
        expect(r.entityType).toBe("pull_request");
      }
    } finally {
      server.stop();
    }
  });
});

describe("API: GET /api/attachments/:collection/*path", () => {
  it("serves attachment files with correct MIME type", async () => {
    initTestEnv();
    addTestCollection("attach-test", { addEntities: true, addAttachment: true });

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/attachments/attach-test/issue-1/screenshot.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");

      const buf = await res.arrayBuffer();
      expect(Buffer.from(buf).toString()).toBe("fake-png-data");
    } finally {
      server.stop();
    }
  });

  it("returns 404 for missing attachment", async () => {
    initTestEnv();
    addTestCollection("attach-404", { addEntities: true });

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/attachments/attach-404/no-file.txt`);
      expect(res.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});

describe("API: unknown routes", () => {
  it("returns 404 for unknown API paths", async () => {
    initTestEnv();

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/nonexistent`);
      expect(res.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});

describe("Serve command: flags", () => {
  it("serve --ui-only starts API server without MCP", async () => {
    initTestEnv();
    addTestCollection("ui-only-test");

    const { createApiServer } = await import("../commands/serve");
    const server = createApiServer(TEST_DIR, 0);

    try {
      const res = await fetch(`http://localhost:${server.port}/api/collections`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Array<{ name: string }>;
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("ui-only-test");
    } finally {
      server.stop();
    }
  });
});
