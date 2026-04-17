import { describe, expect, it } from "bun:test";
import { resolveHttpParams } from "../mcp/http-params";

// Tests for resolveHttpParams — the pure helper that figures out httpUrl and
// bearerToken for an HTTP MCP connection. No module mocking needed because
// the function takes its @frozenink/core dependencies as plain arguments.

const published = {
  mcpUrl: "https://solo.workers.dev/mcp",
  protected: true,
  url: "https://solo.workers.dev",
  publishedAt: new Date().toISOString(),
};

const publicPublished = { ...published, protected: false };

describe("resolveHttpParams", () => {
  it("throws when the collection is not published", () => {
    expect(() =>
      resolveHttpParams("solo", undefined, () => null, () => null, "publish-solo"),
    ).toThrow(/not published/);
  });

  it("uses the provided password over stored credentials", () => {
    const result = resolveHttpParams(
      "solo",
      "override-pw",
      () => published,
      () => ({ password: "stored-pw" }),
      "publish-solo",
    );
    expect(result).toEqual({ httpUrl: "https://solo.workers.dev/mcp", bearerToken: "override-pw" });
  });

  it("falls back to the stored publish credentials when no password is given", () => {
    const result = resolveHttpParams(
      "solo",
      undefined,
      () => published,
      () => ({ password: "stored-pw" }),
      "publish-solo",
    );
    expect(result).toEqual({ httpUrl: "https://solo.workers.dev/mcp", bearerToken: "stored-pw" });
  });

  it("throws when protected but no password is stored", () => {
    expect(() =>
      resolveHttpParams("solo", undefined, () => published, () => null, "publish-solo"),
    ).toThrow(/password protected/);
  });

  it("returns only httpUrl when public and no password", () => {
    const result = resolveHttpParams(
      "solo",
      undefined,
      () => publicPublished,
      () => null,
      "publish-solo",
    );
    expect(result).toEqual({ httpUrl: "https://solo.workers.dev/mcp" });
  });
});
