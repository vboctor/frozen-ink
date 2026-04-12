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
  /**
   * Automatically set by createMcpServer when allowedCollections has exactly
   * one entry. When set, collection_list is omitted and entity tools drop the
   * `collection` parameter (it is inferred from this value).
   */
  singleCollectionName?: string;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  // Derive single-collection mode: when exactly one collection is in scope the
  // `collection` parameter on every entity tool is redundant, and listing
  // collections provides no value.
  const singleCollectionName =
    options.allowedCollections?.length === 1
      ? options.allowedCollections[0]
      : undefined;

  const effectiveOptions: McpServerOptions = { ...options, singleCollectionName };

  const server = new McpServer(
    {
      name: "frozenink",
      version: "0.1.0",
    },
    {
      instructions: singleCollectionName
        ? `Frozen Ink MCP server scoped to the "${singleCollectionName}" collection. Use the entity tools to search and retrieve content.`
        : "Frozen Ink MCP server. Provides collection and entity retrieval tools over synced collections for LLM clients.",
    },
  );

  // collection_list is only useful when there are multiple collections.
  if (!singleCollectionName) {
    registerListCollections(server, effectiveOptions);
  }

  registerSearch(server, effectiveOptions);
  registerGetEntity(server, effectiveOptions);
  registerGetMarkdown(server, effectiveOptions);
  registerGetAttachment(server, effectiveOptions);

  registerCollectionResources(server, effectiveOptions);
  registerEntityResources(server, effectiveOptions);

  return server;
}

export async function startStdioServer(
  options: McpServerOptions,
): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
