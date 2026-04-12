import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { McpToolAdapter, ToolConnectionSpec } from "./types";
import { getMcpServeCommandArgs, resolveFinkCommand } from "./types";

interface ClaudeDesktopMcpServer {
  command: string;
  args: string[];
}

interface ClaudeDesktopConfig {
  mcpServers: Record<string, ClaudeDesktopMcpServer>;
  [key: string]: unknown;
}

function getConfigPath(): string {
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    case "linux":
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude", "claude_desktop_config.json");
    default:
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
}

function getConfigDir(): string {
  return dirname(getConfigPath());
}

function readConfig(): ClaudeDesktopConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { mcpServers: {} };
  }
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
      return { ...parsed, mcpServers: {} };
    }
    return parsed as ClaudeDesktopConfig;
  } catch {
    return { mcpServers: {} };
  }
}

function writeConfig(config: ClaudeDesktopConfig): void {
  const configPath = getConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export const claudeDesktopAdapter: McpToolAdapter = {
  tool: "claude-desktop",
  displayName: "Claude Desktop",

  async isAvailable() {
    if (existsSync(getConfigDir())) {
      return { available: true };
    }
    if (existsSync(getConfigPath())) {
      return { available: true };
    }
    return {
      available: false,
      reason: `Claude Desktop not found at ${getConfigDir()}. Install it from https://claude.ai/download`,
    };
  },

  async addConnection(spec: ToolConnectionSpec): Promise<void> {
    const config = readConfig();
    const commandArgs = getMcpServeCommandArgs(spec.collection);
    const { command, prefixArgs } = resolveFinkCommand();
    config.mcpServers[spec.connectionName] = {
      command,
      args: [...prefixArgs, ...commandArgs.slice(1)],
    };
    writeConfig(config);
  },

  async removeConnection(connectionName: string): Promise<void> {
    const config = readConfig();
    if (!(connectionName in config.mcpServers)) {
      throw new Error(`MCP server "${connectionName}" not found in Claude Desktop config`);
    }
    delete config.mcpServers[connectionName];
    writeConfig(config);
  },

  async listConnectionNames(): Promise<Set<string>> {
    const config = readConfig();
    return new Set(Object.keys(config.mcpServers));
  },
};
