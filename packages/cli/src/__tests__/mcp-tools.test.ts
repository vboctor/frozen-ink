import { describe, expect, it } from "bun:test";
import {
  MCP_TOOL_CANONICAL_NAMES,
  MCP_TOOL_NAMES,
  getConnectionName,
  getMcpServeCommandArgs,
  normalizeMcpToolName,
} from "../mcp/tools";

describe("MCP tool naming and command shape", () => {
  it("uses deterministic per-collection connection names", () => {
    expect(getConnectionName("collection-a")).toBe("fink-collection-a");
    expect(getConnectionName("collection-a")).toBe(getConnectionName("collection-a"));
  });

  it("uses installed-user stdio command (no bun prefix)", () => {
    const args = getMcpServeCommandArgs("collection-a");
    expect(args).toEqual(["fink", "mcp", "serve", "--collection", "collection-a"]);
    expect(args.join(" ")).not.toContain("bun run");
  });

  it("exposes canonical tool names and legacy aliases", () => {
    expect(MCP_TOOL_CANONICAL_NAMES).toEqual([
      "claude-code",
      "claude-desktop",
      "codex-cli",
      "chatgpt-desktop",
      "anythingllm",
    ]);
    expect(MCP_TOOL_NAMES).toContain("codex");
  });

  it("normalizes legacy codex alias to codex-cli", () => {
    expect(normalizeMcpToolName("codex")).toBe("codex-cli");
    expect(normalizeMcpToolName("codex-cli")).toBe("codex-cli");
  });
});
