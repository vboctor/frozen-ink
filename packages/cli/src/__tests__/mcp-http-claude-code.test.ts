import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as core from "@frozenink/core";

const spawnCalls: string[][] = [];

beforeEach(() => {
  spawnCalls.length = 0;

  mock.module("@frozenink/core", () => ({
    ...core,
    spawnProcess: async (args: string[]) => {
      spawnCalls.push(args);
      if (args[1] === "mcp" && args[2] === "--help") {
        return { stdout: "add remove list", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  }));
});

afterEach(() => {
  mock.restore();
});

describe("claude-code adapter HTTP transport", () => {
  it("invokes `claude mcp add --http --url` with --password", async () => {
    const { claudeCodeAdapter } = await import("../mcp/tools/claude-code");

    await claudeCodeAdapter.addConnection({
      collection: "my-vault",
      connectionName: "fink-my-vault",
      transport: "http",
      httpUrl: "https://example.workers.dev/mcp",
      bearerToken: "secret",
    });

    const addCall = spawnCalls.find((call) => call[1] === "mcp" && call[2] === "add");
    expect(addCall).toBeDefined();
    expect(addCall!.slice(1)).toEqual([
      "mcp",
      "add",
      "fink-my-vault",
      "--http",
      "--url",
      "https://example.workers.dev/mcp",
      "--password",
      "secret",
    ]);
  });

  it("omits --password when no bearer token is provided", async () => {
    const { claudeCodeAdapter } = await import("../mcp/tools/claude-code");

    await claudeCodeAdapter.addConnection({
      collection: "public",
      connectionName: "fink-public",
      transport: "http",
      httpUrl: "https://example.workers.dev/mcp",
    });

    const addCall = spawnCalls.find((call) => call[1] === "mcp" && call[2] === "add");
    expect(addCall).toBeDefined();
    expect(addCall!.slice(1)).toEqual([
      "mcp",
      "add",
      "fink-public",
      "--http",
      "--url",
      "https://example.workers.dev/mcp",
    ]);
  });

  it("supportsTransport returns true for both", async () => {
    const { claudeCodeAdapter } = await import("../mcp/tools/claude-code");
    expect(claudeCodeAdapter.supportsTransport("stdio")).toBe(true);
    expect(claudeCodeAdapter.supportsTransport("http")).toBe(true);
  });
});
