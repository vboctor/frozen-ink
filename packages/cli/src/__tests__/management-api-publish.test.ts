import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-management-publish");

type HandleManagementRequest = (req: Request) => Response | null;
type SetPublishOverride = (fn: ((options: {
  collectionNames: string[];
  workerName: string;
  toolDescription?: string;
  password?: string;
  removePassword?: boolean;
  forcePublic?: boolean;
}, onProgress: (step: string, detail: string) => void) => Promise<unknown>) | null) => void;

let handleManagementRequest: HandleManagementRequest;
let setPublishCollectionsOverride: SetPublishOverride;

beforeEach(async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.FROZENINK_HOME = TEST_DIR;

  mock.module("@frozenink/core", () => ({
    getFrozenInkHome: () => TEST_DIR,
    getCollectionDb: () => ({
      select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }),
      insert: () => ({ values: () => ({ run: () => {} }) }),
      delete: () => ({ where: () => ({ run: () => {} }) }),
      update: () => ({ set: () => ({ where: () => ({ run: () => {} }) }) }),
      query: { entities: { findMany: async () => [] } },
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
    }),
    listCollections: () => [],
    getCollection: () => null,
    getCollectionDbPath: () => "",
    addCollection: () => {},
    removeCollection: () => {},
    updateCollection: () => {},
    renameCollection: () => {},
    listSites: () => [],
    removeSite: () => {},
    listDeployments: () => [],
    removeDeployment: () => {},
    loadConfig: () => ({}),
    SyncEngine: class {},
    ThemeEngine: class { register() {} },
    LocalStorageBackend: class {},
    syncRuns: {},
    entities: {},
    tags: {},
    entityTags: {},
    assets: {},
    links: {},
    SearchIndexer: class { updateIndex() {} clearIndex() {} close() {} removeIndex() {} },
    isValidCollectionKey: () => true,
    contextExists: () => true,
    migrateFromLegacyContext: () => {},
    getSite: () => null,
    addSite: () => {},
    getDeployment: () => null,
    addDeployment: () => {},
    configSchema: { parse: (x: any) => x },
    defaultConfig: {},
  }));

  mock.module("@frozenink/crawlers", () => ({
    createDefaultRegistry: () => ({ get: () => null }),
    gitHubTheme: {},
    obsidianTheme: {},
    gitTheme: {},
    mantisBTTheme: {},
  }));

  mock.module("js-yaml", () => ({
    default: { load: () => ({}), dump: () => "" },
  }));

  mock.module("drizzle-orm", () => ({
    desc: () => ({}),
    eq: () => ({}),
    sql: () => ({}),
  }));

  const mod = await import("../commands/management-api");
  handleManagementRequest = mod.handleManagementRequest as HandleManagementRequest;
  setPublishCollectionsOverride = mod.setPublishCollectionsOverride as SetPublishOverride;
});

afterEach(() => {
  setPublishCollectionsOverride(null);
  mock.restore();
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

async function call(req: Request): Promise<Response> {
  const res = handleManagementRequest(req);
  expect(res).not.toBeNull();
  return await Promise.resolve(res as Response);
}

describe("management API publish security options", () => {
  it("forwards password/removal/public flags to publishCollections", async () => {
    let captured: Record<string, unknown> | null = null;
    setPublishCollectionsOverride(async (options) => {
      captured = options as unknown as Record<string, unknown>;
    });

    const postRes = await call(
      new Request("http://localhost/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collections: ["alpha"],
          name: "worker-alpha",
          toolDescription: "Alpha collection helper",
          password: "secret123",
          removePassword: false,
          forcePublic: true,
        }),
      }),
    );
    expect(postRes.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(captured).toBeTruthy();
    expect(captured?.collectionNames).toEqual(["alpha"]);
    expect(captured?.workerName).toBe("worker-alpha");
    expect(captured?.toolDescription).toBe("Alpha collection helper");
    expect(captured?.password).toBe("secret123");
    expect(captured?.removePassword).toBe(false);
    expect(captured?.forcePublic).toBe(true);

    const statusRes = await call(new Request("http://localhost/api/publish/status", { method: "GET" }));
    const status = await statusRes.json() as { active: boolean; step: string; error: string | null };
    expect(status.active).toBe(false);
    expect(status.step).toBe("done");
    expect(status.error).toBeNull();
  });

  it("surfaces failed publish in /api/publish/status", async () => {
    setPublishCollectionsOverride(async () => {
      throw new Error("publish boom");
    });

    await call(
      new Request("http://localhost/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collections: ["alpha"], name: "worker-alpha" }),
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const statusRes = await call(new Request("http://localhost/api/publish/status", { method: "GET" }));
    const status = await statusRes.json() as { active: boolean; step: string; error: string | null };
    expect(status.active).toBe(false);
    expect(status.step).toBe("failed");
    expect(status.error ?? "").toContain("publish boom");
  });
});
