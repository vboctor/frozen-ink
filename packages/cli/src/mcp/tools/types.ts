export const MCP_TOOL_NAMES = ["claude-code", "codex"] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export interface ToolConnectionSpec {
  collection: string;
  connectionName: string;
  description?: string;
}

export interface McpToolAdapter {
  tool: McpToolName;
  displayName: string;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  addConnection(spec: ToolConnectionSpec): Promise<void>;
  removeConnection(connectionName: string): Promise<void>;
  listConnectionNames(): Promise<Set<string>>;
}

export function getConnectionName(collection: string): string {
  return `fink-${collection}`;
}

export function getMcpServeCommandArgs(collection: string): string[] {
  return ["fink", "mcp", "serve", "--collection", collection];
}
