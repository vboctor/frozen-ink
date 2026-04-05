import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListCollections } from "./tools/list-collections";
import { registerSearch } from "./tools/search";
import { registerGetEntity } from "./tools/get-entity";
import { registerQuery } from "./tools/query";
import { registerSync } from "./tools/sync";
import { registerCollectionResources } from "./resources/collection";
import { registerEntityResources } from "./resources/entity";

export interface McpServerOptions {
  veecontextHome: string;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "veecontext",
      version: "0.1.0",
    },
    {
      instructions:
        "VeeContext MCP server. Provides tools to search, query, and sync data across your connected collections.",
    },
  );

  // Register tools
  registerListCollections(server, options);
  registerSearch(server, options);
  registerGetEntity(server, options);
  registerQuery(server, options);
  registerSync(server, options);

  // Register resources
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
