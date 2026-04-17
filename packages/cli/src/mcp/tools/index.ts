import { claudeCodeAdapter } from "./claude-code";
import { claudeDesktopAdapter } from "./claude-desktop";
import { codexAdapter } from "./codex";
import { anythingllmAdapter } from "./anythingllm";
import { chatgptDesktopAdapter } from "./chatgpt-desktop";
import {
  MCP_TOOL_ALIAS_MAP,
  MCP_TOOL_CANONICAL_NAMES,
  MCP_TOOL_NAMES,
  type McpToolAdapter,
  type McpToolAliasName,
  type McpToolCanonicalName,
  type McpToolName,
} from "./types";

const adapterMap: Record<McpToolName, McpToolAdapter> = {
  "claude-code": claudeCodeAdapter,
  "claude-desktop": claudeDesktopAdapter,
  "codex-cli": codexAdapter,
  "chatgpt-desktop": chatgptDesktopAdapter,
  anythingllm: anythingllmAdapter,
  codex: codexAdapter,
};

export { MCP_TOOL_NAMES };
export { MCP_TOOL_CANONICAL_NAMES };
export type {
  McpToolAdapter,
  McpToolCanonicalName,
  McpToolName,
  McpTransport,
} from "./types";
export { getConnectionName, getMcpServeCommandArgs } from "./types";

export function isMcpToolName(value: string): value is McpToolName {
  return MCP_TOOL_NAMES.includes(value as McpToolName);
}

export function normalizeMcpToolName(tool: McpToolName): McpToolCanonicalName {
  return tool in MCP_TOOL_ALIAS_MAP
    ? MCP_TOOL_ALIAS_MAP[tool as McpToolAliasName]
    : (tool as McpToolCanonicalName);
}

export function getMcpToolAdapter(tool: McpToolName): McpToolAdapter {
  return adapterMap[normalizeMcpToolName(tool)];
}

export function listMcpToolAdapters(): McpToolAdapter[] {
  return MCP_TOOL_CANONICAL_NAMES.map((tool) => adapterMap[tool]);
}
