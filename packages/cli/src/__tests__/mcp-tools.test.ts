import { describe, expect, it } from "bun:test";
import { getConnectionName, getMcpServeCommandArgs } from "../mcp/tools";

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
});
