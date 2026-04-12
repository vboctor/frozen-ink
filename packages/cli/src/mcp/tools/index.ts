import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import {
  MCP_TOOL_NAMES,
  type McpToolAdapter,
  type McpToolName,
} from "./types";

const adapterMap: Record<McpToolName, McpToolAdapter> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
};

export { MCP_TOOL_NAMES };
export type { McpToolAdapter, McpToolName } from "./types";
export { getConnectionName, getMcpServeCommandArgs } from "./types";

export function isMcpToolName(value: string): value is McpToolName {
  return MCP_TOOL_NAMES.includes(value as McpToolName);
}

export function getMcpToolAdapter(tool: McpToolName): McpToolAdapter {
  return adapterMap[tool];
}

export function listMcpToolAdapters(): McpToolAdapter[] {
  return MCP_TOOL_NAMES.map((tool) => adapterMap[tool]);
}
