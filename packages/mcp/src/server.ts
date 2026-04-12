import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListCollections } from "./tools/list-collections";
import { registerSearch } from "./tools/search";
import { registerGetEntity } from "./tools/get-entity";
import { registerGetMarkdown } from "./tools/get-markdown";
import { registerGetAttachment } from "./tools/get-attachment";
import { registerCollectionResources } from "./resources/collection";
import { registerEntityResources } from "./resources/entity";

export interface McpServerOptions {
  frozeninkHome: string;
  allowedCollections?: string[];
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "frozenink",
      version: "0.1.0",
    },
    {
      instructions:
        "Frozen Ink MCP server. Provides collection and entity retrieval tools over synced collections for LLM clients.",
    },
  );

  registerListCollections(server, options);
  registerSearch(server, options);
  registerGetEntity(server, options);
  registerGetMarkdown(server, options);
  registerGetAttachment(server, options);

  registerCollectionResources(server, options);
  registerEntityResources(server, options);

  return server;
}

export async function startStdioServer(
  options: McpServerOptions,
): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
