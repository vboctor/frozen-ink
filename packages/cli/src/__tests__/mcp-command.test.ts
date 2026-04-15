import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { ensureInitialized } from "@frozenink/core";

const TEST_DIR = join(import.meta.dir, ".test-mcp-command");

let addArgs: unknown;
let removeArgs: unknown;
let listArg: unknown;

beforeEach(() => {
  addArgs = null;
  removeArgs = null;
  listArg = null;

  mkdirSync(TEST_DIR, { recursive: true });
  process.env.FROZENINK_HOME = TEST_DIR;
  ensureInitialized();

  mock.module("../mcp/manager", () => ({
    addMcpConnections: async (opts: unknown) => {
      addArgs = opts;
      return [];
    },
    removeMcpConnections: async (opts: unknown) => {
      removeArgs = opts;
      return [];
    },
    listMcpConnections: async (tool?: unknown) => {
      listArg = tool;
      return [];
    },
  }));
});

afterEach(() => {
  mock.restore();
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.FROZENINK_HOME;
});

describe("mcp command", () => {
  it("add passes multiple collections in one request", async () => {
    const { addCollection } = await import("@frozenink/core");
    addCollection("collection-a", { crawler: "github", config: {}, credentials: {} });
    addCollection("collection-b", { crawler: "github", config: {}, credentials: {} });

    const { mcpCommand } = await import("../commands/mcp");
    await mcpCommand.parseAsync([
      "add",
      "--tool",
      "claude-code",
      "collection-a",
      "collection-b",
    ], { from: "user" });

    expect(addArgs).toEqual({
      tool: "claude-code",
      collections: ["collection-a", "collection-b"],
      description: undefined,
    });
  });

  it("remove passes multiple collections in one request", async () => {
    const { addCollection } = await import("@frozenink/core");
    addCollection("collection-a", { crawler: "github", config: {}, credentials: {} });
    addCollection("collection-b", { crawler: "github", config: {}, credentials: {} });

    const { mcpCommand } = await import("../commands/mcp");
    await mcpCommand.parseAsync([
      "remove",
      "--tool",
      "claude-code",
      "collection-a",
      "collection-b",
    ], { from: "user" });

    expect(removeArgs).toEqual({
      tool: "claude-code",
      collections: ["collection-a", "collection-b"],
    });
  });

  it("list forwards optional tool filter", async () => {
    const { mcpCommand } = await import("../commands/mcp");
    await mcpCommand.parseAsync(["list", "--tool", "claude-code"], { from: "user" });

    expect(listArg).toBe("claude-code");
  });

  it("accepts codex-cli as the canonical Codex tool name", async () => {
    const { addCollection } = await import("@frozenink/core");
    addCollection("collection-a", { crawler: "github", config: {}, credentials: {} });

    const { mcpCommand } = await import("../commands/mcp");
    await mcpCommand.parseAsync([
      "add",
      "--tool",
      "codex-cli",
      "collection-a",
    ], { from: "user" });

    expect(addArgs).toEqual({
      tool: "codex-cli",
      collections: ["collection-a"],
      description: undefined,
    });
  });

  it("accepts chatgpt-desktop tool name", async () => {
    const { mcpCommand } = await import("../commands/mcp");
    await mcpCommand.parseAsync(["list", "--tool", "chatgpt-desktop"], { from: "user" });

    expect(listArg).toBe("chatgpt-desktop");
  });

  it("normalizes legacy codex alias to codex-cli", async () => {
    const { mcpCommand } = await import("../commands/mcp");
    await mcpCommand.parseAsync(["list", "--tool", "codex"], { from: "user" });

    expect(listArg).toBe("codex-cli");
  });
});
