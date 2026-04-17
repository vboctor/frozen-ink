import { describe, expect, it } from "bun:test";
import { claudeDesktopAdapter } from "../mcp/tools/claude-desktop";

// Writing the config file requires overriding os.homedir(), which Bun resolves
// via getpwuid() and ignores $HOME. The end-to-end HTTP spec routing is
// covered by mcp-manager-http.test.ts; here we assert the adapter surface.
describe("claude-desktop adapter transport support", () => {
  it("reports HTTP and stdio support", () => {
    expect(claudeDesktopAdapter.supportsTransport("http")).toBe(true);
    expect(claudeDesktopAdapter.supportsTransport("stdio")).toBe(true);
  });
});
