import { spawnProcess } from "@frozenink/core";
import {
  getMcpServeCommandArgs,
  type McpToolAdapter,
  type ToolConnectionSpec,
} from "./types";

const BINARY = "codex";

async function runCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const res = await spawnProcess([BINARY, ...args]);
    return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
  } catch (err) {
    throw new Error(
      `Codex CLI not found on PATH. Install/enable it, then retry. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function parseConnectionNames(output: string): Set<string> {
  const names = new Set<string>();
  const trimmed = output.trim();
  if (!trimmed) return names;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === "object" && "mcpServers" in parsed
        ? (parsed as { mcpServers?: unknown[] }).mcpServers ?? []
        : []);

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const candidate = (row as { name?: unknown; id?: unknown }).name ?? (row as { id?: unknown }).id;
      if (typeof candidate === "string" && candidate.length > 0) {
        names.add(candidate);
      }
    }
    if (names.size > 0) return names;
  } catch {
    // Fallback parser below.
  }

  for (const line of trimmed.split("\n")) {
    const token = line.trim().split(/\s+/)[0];
    if (token && token !== "Name" && token !== "-" && !token.startsWith("(")) {
      names.add(token);
    }
  }

  return names;
}

async function ensureSuccess(args: string[], operation: string): Promise<void> {
  const res = await runCommand(args);
  if (res.exitCode !== 0) {
    const detail = (res.stderr || res.stdout).trim() || `exit code ${res.exitCode}`;
    throw new Error(`Codex ${operation} failed: ${detail}`);
  }
}

export const codexAdapter: McpToolAdapter = {
  tool: "codex-cli",
  displayName: "Codex CLI",

  async isAvailable() {
    try {
      const help = await runCommand(["mcp", "--help"]);
      if (help.exitCode !== 0) {
        return { available: false, reason: (help.stderr || help.stdout).trim() || "mcp command unavailable" };
      }

      const out = `${help.stdout}\n${help.stderr}`.toLowerCase();
      const hasCommands = out.includes("add") && out.includes("remove") && out.includes("list");
      if (!hasCommands) {
        return { available: false, reason: "`codex mcp` add/remove/list commands not detected" };
      }

      return { available: true };
    } catch (err) {
      return { available: false, reason: err instanceof Error ? err.message : String(err) };
    }
  },

  supportsTransport(transport) {
    return transport === "stdio";
  },

  async addConnection(spec: ToolConnectionSpec): Promise<void> {
    if (spec.transport !== "stdio") {
      throw new Error("Codex CLI does not support HTTP MCP transport yet");
    }
    const commandArgs = getMcpServeCommandArgs(spec.collection);
    const args = ["mcp", "add", spec.connectionName];
    if (spec.description) {
      args.push("--description", spec.description);
    }
    args.push("--", ...commandArgs);
    await ensureSuccess(args, "mcp add");
  },

  async removeConnection(connectionName: string): Promise<void> {
    await ensureSuccess(["mcp", "remove", connectionName], "mcp remove");
  },

  async listConnectionNames(): Promise<Set<string>> {
    const jsonRes = await runCommand(["mcp", "list", "--json"]);
    if (jsonRes.exitCode === 0) {
      return parseConnectionNames(jsonRes.stdout || jsonRes.stderr);
    }

    const textRes = await runCommand(["mcp", "list"]);
    if (textRes.exitCode !== 0) {
      const detail = (textRes.stderr || textRes.stdout).trim() || `exit code ${textRes.exitCode}`;
      throw new Error(`Codex mcp list failed: ${detail}`);
    }

    return parseConnectionNames(textRes.stdout || textRes.stderr);
  },
};
