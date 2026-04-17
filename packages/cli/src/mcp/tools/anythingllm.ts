import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { McpToolAdapter, ToolConnectionSpec } from "./types";
import { getMcpServeCommandArgs, resolveFinkCommand } from "./types";

interface AnythingLLMMcpServer {
  command: string;
  args: string[];
}

interface AnythingLLMMcpConfig {
  mcpServers: Record<string, AnythingLLMMcpServer>;
}

function getConfigPath(): string {
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "anythingllm-desktop", "storage", "plugins", "anythingllm_mcp_servers.json");
    case "linux":
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "anythingllm-desktop", "storage", "plugins", "anythingllm_mcp_servers.json");
    default: // macOS
      return join(home, "Library", "Application Support", "anythingllm-desktop", "storage", "plugins", "anythingllm_mcp_servers.json");
  }
}

function getStorageDir(): string {
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "anythingllm-desktop", "storage");
    case "linux":
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "anythingllm-desktop", "storage");
    default:
      return join(home, "Library", "Application Support", "anythingllm-desktop", "storage");
  }
}

function readConfig(): AnythingLLMMcpConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { mcpServers: {} };
  }
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "mcpServers" in parsed) {
      return parsed as AnythingLLMMcpConfig;
    }
  } catch {
    // Treat corrupted config as empty
  }
  return { mcpServers: {} };
}

function writeConfig(config: AnythingLLMMcpConfig): void {
  const configPath = getConfigPath();
  const dir = join(configPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export const anythingllmAdapter: McpToolAdapter = {
  tool: "anythingllm",
  displayName: "AnythingLLM",

  async isAvailable() {
    const storageDir = getStorageDir();
    if (existsSync(storageDir)) {
      return { available: true };
    }
    // Config file itself existing is also sufficient (in case storage dir was moved)
    if (existsSync(getConfigPath())) {
      return { available: true };
    }
    return {
      available: false,
      reason: `AnythingLLM desktop app not found at ${storageDir}. Install it from https://anythingllm.com`,
    };
  },

  supportsTransport(transport) {
    return transport === "stdio";
  },

  async addConnection(spec: ToolConnectionSpec): Promise<void> {
    if (spec.transport !== "stdio") {
      throw new Error("AnythingLLM does not support HTTP MCP transport yet");
    }
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
      throw new Error(`MCP server "${connectionName}" not found in AnythingLLM config`);
    }
    delete config.mcpServers[connectionName];
    writeConfig(config);
  },

  async listConnectionNames(): Promise<Set<string>> {
    const config = readConfig();
    return new Set(Object.keys(config.mcpServers));
  },
};
