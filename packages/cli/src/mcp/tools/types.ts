export const MCP_TOOL_CANONICAL_NAMES = [
  "claude-code",
  "claude-desktop",
  "codex-cli",
  "chatgpt-desktop",
  "anythingllm",
] as const;

export const MCP_TOOL_ALIAS_MAP = {
  codex: "codex-cli",
} as const;

export const MCP_TOOL_NAMES = [
  "claude-code",
  "claude-desktop",
  "codex-cli",
  "chatgpt-desktop",
  "anythingllm",
  "codex",
] as const;

export type McpToolCanonicalName = (typeof MCP_TOOL_CANONICAL_NAMES)[number];
export type McpToolAliasName = keyof typeof MCP_TOOL_ALIAS_MAP;
export type McpToolName = McpToolCanonicalName | McpToolAliasName;

export type McpTransport = "stdio" | "http";

export type ToolConnectionSpec =
  | {
      collection: string;
      connectionName: string;
      description?: string;
      transport: "stdio";
    }
  | {
      collection: string;
      connectionName: string;
      description?: string;
      transport: "http";
      httpUrl: string;
      bearerToken?: string;
    };

export interface McpToolAdapter {
  tool: McpToolCanonicalName;
  displayName: string;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  supportsTransport(transport: McpTransport): boolean;
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

/**
 * Resolve the command and args needed to spawn fink from a desktop app.
 *
 * End users install fink as either:
 *   - A standalone compiled binary → just needs the absolute path.
 *   - An npm global package → node script, just needs the absolute path.
 *
 * Dev machines may have fink as a `#!/usr/bin/env bun` script linked via bun.
 * Desktop apps (Electron) inherit the macOS launchd PATH, which doesn't include
 * ~/.bun/bin, so `env bun` fails. We detect the shebang and resolve the
 * interpreter to its absolute path.
 */
export function resolveFinkCommand(): { command: string; prefixArgs: string[] } {
  const { execFileSync } = require("child_process");
  const { readFileSync } = require("fs");

  function which(binary: string): string {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const result = (execFileSync(cmd, [binary], { encoding: "utf8" }) as string).trim();
      return result.split("\n")[0].trim() || binary;
    } catch {
      return binary;
    }
  }

  const finkPath = which("fink");

  try {
    const head = (readFileSync(finkPath, "utf8") as string).slice(0, 256);
    const match = head.match(/^#!\/usr\/bin\/env\s+(\S+)/);
    if (match) {
      return { command: which(match[1]), prefixArgs: [finkPath] };
    }
  } catch {
    // Not a text file — compiled binary; use directly.
  }

  return { command: finkPath, prefixArgs: [] };
}
