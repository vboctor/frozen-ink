import type { McpToolAdapter, ToolConnectionSpec } from "./types";

function getChatGptRemediationMessage(): string {
  return [
    "ChatGPT Desktop does not currently expose a stable local MCP config file for `fink mcp add` integration.",
    "Use Frozen Ink's remote MCP flow instead:",
    "1) Publish collections: `fink publish <collections...> --name <name> --password <password>`",
    "2) In ChatGPT, add the deployment MCP endpoint: `https://<name>.workers.dev/mcp`",
    "3) Provide `Authorization: Bearer <password>` in the connector configuration.",
  ].join(" ");
}

export const chatgptDesktopAdapter: McpToolAdapter = {
  tool: "chatgpt-desktop",
  displayName: "ChatGPT Desktop",

  async isAvailable() {
    return { available: true };
  },

  supportsTransport(transport) {
    return transport === "stdio";
  },

  async addConnection(_spec: ToolConnectionSpec): Promise<void> {
    throw new Error(getChatGptRemediationMessage());
  },

  async removeConnection(_connectionName: string): Promise<void> {
    throw new Error(
      "Local `fink mcp remove` is not supported for ChatGPT Desktop because links are managed in the ChatGPT app. " +
      "Remove the remote MCP connector from ChatGPT settings directly.",
    );
  },

  async listConnectionNames(): Promise<Set<string>> {
    // ChatGPT Desktop MCP connectors are remote-managed; no local deterministic list is available.
    return new Set();
  },
};
