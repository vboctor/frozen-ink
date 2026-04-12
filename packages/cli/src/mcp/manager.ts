import {
  getCollection,
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

export interface AvailableToolInfo {
  tool: McpToolCanonicalName;
  displayName: string;
  available: boolean;
  reason?: string;
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
    });
  }

  return rows;
}

export async function addMcpConnections(params: {
  tool: McpToolCanonicalName;
  collections: string[];
  description?: string;
}): Promise<AddMcpResult[]> {
  // Remote-only integrations (for example ChatGPT Desktop) don't spawn local stdio subprocesses.
  if (params.tool !== "chatgpt-desktop") {
    await ensureFinkOnPath();
  }
  await ensureToolAvailable(params.tool);

  const adapter = getMcpToolAdapter(params.tool);
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
    await adapter.addConnection({
      collection: collectionName,
      connectionName,
      description: finalDescription,
    });

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
