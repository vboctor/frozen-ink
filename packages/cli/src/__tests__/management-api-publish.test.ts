import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-management-publish");

type HandleManagementRequest = (req: Request) => Response | null;
type SetPublishOverride = (fn: ((options: {
  collectionName: string;
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
    updateCollectionSyncState: () => {},
    getCollectionSyncState: () => ({}),
    renameCollection: () => {},
    getCollectionPublishState: () => null,
    updateCollectionPublishState: () => {},
    clearCollectionPublishState: () => {},
    listPublishedCollections: () => [],
    listSites: () => [],
    removeSite: () => {},
    getSite: () => null,
    addSite: () => {},
    loadConfig: () => ({}),
    resolveCredentials: () => ({}),
    listNamedCredentials: () => [],
    getNamedCredentials: () => null,
    saveNamedCredentials: () => {},
    removeNamedCredentials: () => {},
    SyncEngine: class {},
    ThemeEngine: class { register() {} },
    LocalStorageBackend: class {},
    entities: {},
    SearchIndexer: class { updateIndex() {} clearIndex() {} close() {} removeIndex() {} },
    entityMarkdownPath: () => "",
    splitMarkdownPath: () => ({ folder: "", slug: "" }),
    computeEntityHash: () => "",
    exportStaticSite: async () => {},
    spawnDetached: () => ({}),
    resolveWrangler: () => "",
    MetadataStore: class {},
    isValidCollectionKey: () => true,
    contextExists: () => true,
    ensureInitialized: () => {},
    migrateFromLegacyContext: () => {},
    configSchema: { parse: (x: any) => x },
    defaultConfig: {},
    extractWikilinks: () => [],
    frontmatter: () => "",
    wikilink: () => "",
    callout: () => "",
    embed: () => "",
    createCryptoHasher: () => ({ update: () => {}, digest: () => "" }),
    openDatabase: () => ({}),
    getModuleDir: () => "",
    resolveWorkerBundle: () => "",
    resolveUiDist: () => "",
    isBun: true,
    spawnProcess: () => ({ exitCode: 0 }),
  }));

  mock.module("@frozenink/crawlers", () => ({
    createDefaultRegistry: () => ({ get: () => null }),
    gitHubTheme: {},
    obsidianTheme: {},
    gitTheme: {},
    mantisHubTheme: {},
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
      new Request("http://localhost/api/collections/alpha/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
    expect(captured?.collectionName).toBe("alpha");
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
      new Request("http://localhost/api/collections/alpha/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
