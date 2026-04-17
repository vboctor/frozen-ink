import {
  getCollection,
  getCollectionPublishState,
  getNamedCredentials,
  listCollections,
  updateCollection,
  spawnProcess,
} from "@frozenink/core";
import {
  getConnectionName,
  getMcpToolAdapter,
  listMcpToolAdapters,
  type McpToolCanonicalName,
} from "./tools";
import type { McpTransport } from "./tools/types";
import { getPublishCredentialKey } from "../commands/publish-credentials";
import { resolveHttpParams } from "./http-params";

export interface AvailableToolInfo {
  tool: McpToolCanonicalName;
  displayName: string;
  available: boolean;
  reason?: string;
  supportsStdio: boolean;
  supportsHttp: boolean;
}

export interface AddMcpResult {
  collection: string;
  connectionName: string;
  description?: string;
}

export interface RemoveMcpResult {
  collection: string;
  connectionName: string;
}

export interface ToolCollectionLink {
  collection: string;
  connectionName: string;
  linked: boolean;
  description?: string;
}

export interface ToolLinkStatus {
  tool: McpToolCanonicalName;
  displayName: string;
  available: boolean;
  reason?: string;
  supportsStdio: boolean;
  supportsHttp: boolean;
  links: ToolCollectionLink[];
}

async function ensureFinkOnPath(): Promise<void> {
  try {
    const result = await spawnProcess(["fink", "--version"]);
    if (result.exitCode !== 0) {
      throw new Error((result.stderr || result.stdout).trim() || `exit code ${result.exitCode}`);
    }
  } catch (err) {
    throw new Error(
      "`fink` is not on PATH for subprocesses. Add it to PATH before running `fink mcp add`, " +
      "or install globally via npm/binary so MCP clients can execute `fink mcp serve`.",
    );
  }
}

async function ensureToolAvailable(tool: McpToolCanonicalName): Promise<void> {
  const adapter = getMcpToolAdapter(tool);
  const availability = await adapter.isAvailable();
  if (!availability.available) {
    throw new Error(
      `${adapter.displayName} MCP CLI support is unavailable${availability.reason ? `: ${availability.reason}` : ""}`,
    );
  }
}

export async function listAvailableMcpTools(): Promise<AvailableToolInfo[]> {
  const adapters = listMcpToolAdapters();
  const rows: AvailableToolInfo[] = [];

  for (const adapter of adapters) {
    const availability = await adapter.isAvailable();
    rows.push({
      tool: adapter.tool,
      displayName: adapter.displayName,
      available: availability.available,
      reason: availability.reason,
      supportsStdio: adapter.supportsTransport("stdio"),
      supportsHttp: adapter.supportsTransport("http"),
    });
  }

  return rows;
}

function getHttpParams(collectionName: string, providedPassword: string | undefined) {
  return resolveHttpParams(
    collectionName,
    providedPassword,
    getCollectionPublishState,
    getNamedCredentials,
    getPublishCredentialKey(collectionName),
  );
}

export async function addMcpConnections(params: {
  tool: McpToolCanonicalName;
  collections: string[];
  description?: string;
  transport?: McpTransport;
  password?: string;
}): Promise<AddMcpResult[]> {
  const transport: McpTransport = params.transport ?? "stdio";

  const adapter = getMcpToolAdapter(params.tool);
  if (!adapter.supportsTransport(transport)) {
    throw new Error(
      `${adapter.displayName} does not support ${transport === "http" ? "HTTP" : "stdio"} MCP transport yet`,
    );
  }

  // Stdio needs `fink` on PATH for subprocess spawns; HTTP doesn't.
  if (transport === "stdio" && params.tool !== "chatgpt-desktop") {
    await ensureFinkOnPath();
  }
  await ensureToolAvailable(params.tool);

  const results: AddMcpResult[] = [];

  for (const collectionName of params.collections) {
    const collection = getCollection(collectionName);
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    const providedDescription = params.description?.trim();
    const finalDescription = providedDescription || collection.mcpToolDescription?.trim() || undefined;

    if (providedDescription) {
      updateCollection(collectionName, { mcpToolDescription: providedDescription });
    }

    const connectionName = getConnectionName(collectionName);
    if (transport === "http") {
      const { httpUrl, bearerToken } = getHttpParams(collectionName, params.password);
      await adapter.addConnection({
        collection: collectionName,
        connectionName,
        description: finalDescription,
        transport: "http",
        httpUrl,
        bearerToken,
      });
    } else {
      await adapter.addConnection({
        collection: collectionName,
        connectionName,
        description: finalDescription,
        transport: "stdio",
      });
    }

    results.push({
      collection: collectionName,
      connectionName,
      description: finalDescription,
    });
  }

  return results;
}

export async function removeMcpConnections(params: {
  tool: McpToolCanonicalName;
  collections: string[];
}): Promise<RemoveMcpResult[]> {
  await ensureToolAvailable(params.tool);

  const adapter = getMcpToolAdapter(params.tool);
  const results: RemoveMcpResult[] = [];

  for (const collectionName of params.collections) {
    const collection = getCollection(collectionName);
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    const connectionName = getConnectionName(collectionName);
    await adapter.removeConnection(connectionName);
    results.push({ collection: collectionName, connectionName });
  }

  return results;
}

export async function listMcpConnections(tool?: McpToolCanonicalName): Promise<ToolLinkStatus[]> {
  const adapters = tool
    ? [getMcpToolAdapter(tool)]
    : listMcpToolAdapters();

  const collections = listCollections();
  const allStatuses: ToolLinkStatus[] = [];

  for (const adapter of adapters) {
    const availability = await adapter.isAvailable();
    if (!availability.available) {
      allStatuses.push({
        tool: adapter.tool,
        displayName: adapter.displayName,
        available: false,
        reason: availability.reason,
        supportsStdio: adapter.supportsTransport("stdio"),
        supportsHttp: adapter.supportsTransport("http"),
        links: collections.map((collection) => ({
          collection: collection.name,
          connectionName: getConnectionName(collection.name),
          linked: false,
          description: collection.mcpToolDescription,
        })),
      });
      continue;
    }

    const connectionNames = await adapter.listConnectionNames();
    allStatuses.push({
      tool: adapter.tool,
      displayName: adapter.displayName,
      available: true,
      supportsStdio: adapter.supportsTransport("stdio"),
      supportsHttp: adapter.supportsTransport("http"),
      links: collections.map((collection) => {
        const connectionName = getConnectionName(collection.name);
        return {
          collection: collection.name,
          connectionName,
          linked: connectionNames.has(connectionName),
          description: collection.mcpToolDescription,
        };
      }),
    });
  }

  return allStatuses;
}
