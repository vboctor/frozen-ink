import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// In-memory stand-in for @frozenink/core state read by the manager. Using a
// fully-synthetic mock keeps this test independent of whatever state any
// sibling test file's `mock.module("@frozenink/core", ...)` left behind.
const state: {
  collections: Map<string, Record<string, unknown>>;
  publishState: Map<string, Record<string, unknown>>;
  creds: Map<string, Record<string, unknown>>;
} = {
  collections: new Map(),
  publishState: new Map(),
  creds: new Map(),
};

interface CapturedCall {
  spec?: unknown;
}

const captured: { claudeCode: CapturedCall; claudeDesktop: CapturedCall; codex: CapturedCall } = {
  claudeCode: {},
  claudeDesktop: {},
  codex: {},
};

function makeAdapter(
  tool: string,
  displayName: string,
  supports: (t: "stdio" | "http") => boolean,
  slot: CapturedCall,
) {
  return {
    tool,
    displayName,
    async isAvailable() { return { available: true }; },
    supportsTransport: supports,
    async addConnection(spec: unknown) { slot.spec = spec; },
    async removeConnection() {},
    async listConnectionNames() { return new Set<string>(); },
  };
}

beforeEach(() => {
  state.collections.clear();
  state.publishState.clear();
  state.creds.clear();

  captured.claudeCode = {};
  captured.claudeDesktop = {};
  captured.codex = {};

  mock.module("@frozenink/core", () => ({
    getCollection: (name: string) => state.collections.get(name) ?? null,
    listCollections: () => Array.from(state.collections.values()),
    updateCollection: (name: string, updates: Record<string, unknown>) => {
      const existing = state.collections.get(name);
      if (existing) state.collections.set(name, { ...existing, ...updates });
    },
    getCollectionPublishState: (name: string) => state.publishState.get(name) ?? null,
    getNamedCredentials: (name: string) => state.creds.get(name) ?? null,
    spawnProcess: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  }));

  const claudeCodeAdapter = makeAdapter("claude-code", "Claude Code", () => true, captured.claudeCode);
  const claudeDesktopAdapter = makeAdapter("claude-desktop", "Claude Desktop", () => true, captured.claudeDesktop);
  const codexAdapter = makeAdapter("codex-cli", "Codex CLI", (t) => t === "stdio", captured.codex);

  const adapterMap: Record<string, unknown> = {
    "claude-code": claudeCodeAdapter,
    "claude-desktop": claudeDesktopAdapter,
    "codex-cli": codexAdapter,
    "chatgpt-desktop": makeAdapter("chatgpt-desktop", "ChatGPT Desktop", (t) => t === "stdio", { spec: undefined }),
    anythingllm: makeAdapter("anythingllm", "AnythingLLM", (t) => t === "stdio", { spec: undefined }),
  };

  mock.module("../mcp/tools", () => ({
    MCP_TOOL_NAMES: [
      "claude-code",
      "claude-desktop",
      "codex-cli",
      "chatgpt-desktop",
      "anythingllm",
      "codex",
    ],
    MCP_TOOL_CANONICAL_NAMES: [
      "claude-code",
      "claude-desktop",
      "codex-cli",
      "chatgpt-desktop",
      "anythingllm",
    ],
    isMcpToolName: (v: string) => v in adapterMap || v === "codex",
    normalizeMcpToolName: (v: string) => (v === "codex" ? "codex-cli" : v),
    getMcpToolAdapter: (v: string) => adapterMap[v === "codex" ? "codex-cli" : v],
    listMcpToolAdapters: () => Object.values(adapterMap),
    getConnectionName: (collection: string) => `fink-${collection}`,
    getMcpServeCommandArgs: (collection: string) => ["fink", "mcp", "serve", "--collection", collection],
  }));
});

afterEach(() => {
  mock.restore();
});

function seedCollection(name: string): void {
  state.collections.set(name, { name, crawler: "github", config: {}, credentials: {} });
}

function seedPublished(name: string, opts: { protected: boolean }): void {
  state.publishState.set(name, {
    url: `https://${name}.workers.dev`,
    mcpUrl: `https://${name}.workers.dev/mcp`,
    protected: opts.protected,
    publishedAt: new Date().toISOString(),
  });
}

describe("addMcpConnections with transport: http", () => {
  it("errors when the collection is not published", async () => {
    seedCollection("solo");
    const { addMcpConnections } = await import("../mcp/manager");
    await expect(
      addMcpConnections({
        tool: "claude-code",
        collections: ["solo"],
        transport: "http",
      }),
    ).rejects.toThrow(/not published/);
  });

  it("errors for tools that do not support HTTP", async () => {
    seedCollection("solo");
    seedPublished("solo", { protected: false });
    const { addMcpConnections } = await import("../mcp/manager");
    await expect(
      addMcpConnections({
        tool: "codex-cli",
        collections: ["solo"],
        transport: "http",
      }),
    ).rejects.toThrow(/HTTP MCP transport/);
  });

  it("uses the provided --password over the stored credentials", async () => {
    seedCollection("solo");
    seedPublished("solo", { protected: true });
    state.creds.set("publish-solo", { password: "stored-pw" });

    const { addMcpConnections } = await import("../mcp/manager");
    await addMcpConnections({
      tool: "claude-desktop",
      collections: ["solo"],
      transport: "http",
      password: "override-pw",
    });

    expect(captured.claudeDesktop.spec).toMatchObject({
      transport: "http",
      httpUrl: "https://solo.workers.dev/mcp",
      bearerToken: "override-pw",
    });
  });

  it("falls back to the stored publish credentials when no --password is given", async () => {
    seedCollection("solo");
    seedPublished("solo", { protected: true });
    state.creds.set("publish-solo", { password: "stored-pw" });

    const { addMcpConnections } = await import("../mcp/manager");
    await addMcpConnections({
      tool: "claude-desktop",
      collections: ["solo"],
      transport: "http",
    });

    expect(captured.claudeDesktop.spec).toMatchObject({
      bearerToken: "stored-pw",
    });
  });

  it("errors when the site is password-protected but no password is stored", async () => {
    seedCollection("solo");
    seedPublished("solo", { protected: true });

    const { addMcpConnections } = await import("../mcp/manager");
    await expect(
      addMcpConnections({
        tool: "claude-code",
        collections: ["solo"],
        transport: "http",
      }),
    ).rejects.toThrow(/password protected/);
  });
});
