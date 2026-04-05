import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import { getVeeContextHome } from "@veecontext/core";
import { startStdioServer } from "@veecontext/mcp";

export const serveCommand = new Command("serve")
  .description("Start the MCP server")
  .option("--mcp-only", "Start only the MCP server (no UI API server)")
  .action(async (opts: { mcpOnly?: boolean }) => {
    const home = getVeeContextHome();
    const masterDbPath = join(home, "master.db");

    if (!existsSync(masterDbPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    console.error("Starting VeeContext MCP server (STDIO)...");

    await startStdioServer({ veecontextHome: home });
  });
