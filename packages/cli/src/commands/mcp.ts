import { Command } from "commander";
import {
  contextExists,
  getCollection,
  getFrozenInkHome,
} from "@frozenink/core";
import { startStdioServer } from "@frozenink/mcp";
import {
  MCP_TOOL_CANONICAL_NAMES,
  isMcpToolName,
  normalizeMcpToolName,
  type McpToolCanonicalName,
} from "../mcp/tools";
import {
  addMcpConnections,
  listMcpConnections,
  removeMcpConnections,
} from "../mcp/manager";

function parseTool(value: string): McpToolCanonicalName {
  const normalized = value.trim().toLowerCase();
  if (!isMcpToolName(normalized)) {
    throw new Error(
      `Unsupported MCP tool "${value}". Use one of: ${MCP_TOOL_CANONICAL_NAMES.join(", ")} ` +
      "(legacy alias: codex -> codex-cli)",
    );
  }
  return normalizeMcpToolName(normalized);
}

function requireInitialized(): void {
  if (!contextExists()) {
    console.error("Frozen Ink not initialized. Run: fink init");
    process.exit(1);
  }
}

export const mcpCommand = new Command("mcp")
  .description("Manage MCP tool registrations and run collection-scoped MCP stdio server");

const TOOL_HELP =
  `${MCP_TOOL_CANONICAL_NAMES.join(", ")} (legacy alias: codex -> codex-cli)`;

mcpCommand
  .command("serve")
  .description("Run MCP stdio server scoped to a single collection")
  .requiredOption("--collection <name>", "Collection name")
  .action(async (opts: { collection: string }) => {
    requireInitialized();

    const col = getCollection(opts.collection);
    if (!col) {
      console.error(`Collection "${opts.collection}" not found`);
      process.exit(1);
    }

    console.error(`Starting Frozen Ink MCP server (STDIO) for collection "${opts.collection}"...`);
    await startStdioServer({
      frozeninkHome: getFrozenInkHome(),
      allowedCollections: [opts.collection],
      collectionTitle: col.title,
      collectionDescription: col.description,
    });
  });

mcpCommand
  .command("add")
  .description("Add MCP tool links for one or more collections")
  .requiredOption("--tool <tool>", `Target MCP client tool (${TOOL_HELP})`)
  .option("--description <text>", "Optional tool description to store on collection(s)")
  .argument("<collections...>", "Collection names")
  .action(async (collectionNames: string[], opts: { tool: string; description?: string }) => {
    requireInitialized();
    const tool = parseTool(opts.tool);

    try {
      const results = await addMcpConnections({
        tool,
        collections: collectionNames,
        description: opts.description,
      });

      for (const row of results) {
        console.log(`Linked ${row.collection} -> ${tool} (${row.connectionName})`);
      }
      console.log(`Added ${results.length} MCP link(s).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to add MCP links: ${message}`);
      process.exit(1);
    }
  });

mcpCommand
  .command("remove")
  .description("Remove MCP tool links for one or more collections")
  .requiredOption("--tool <tool>", `Target MCP client tool (${TOOL_HELP})`)
  .argument("<collections...>", "Collection names")
  .action(async (collectionNames: string[], opts: { tool: string }) => {
    requireInitialized();
    const tool = parseTool(opts.tool);

    try {
      const results = await removeMcpConnections({
        tool,
        collections: collectionNames,
      });

      for (const row of results) {
        console.log(`Removed ${row.collection} from ${tool} (${row.connectionName})`);
      }
      console.log(`Removed ${results.length} MCP link(s).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to remove MCP links: ${message}`);
      process.exit(1);
    }
  });

mcpCommand
  .command("list")
  .description("List MCP tool links by collection")
  .option("--tool <tool>", `Filter by tool (${TOOL_HELP})`)
  .action(async (opts: { tool?: string }) => {
    requireInitialized();

    try {
      const statuses = await listMcpConnections(opts.tool ? parseTool(opts.tool) : undefined);

      for (const status of statuses) {
        console.log(`\n${status.displayName} (${status.tool})`);
        if (!status.available) {
          console.log(`  unavailable: ${status.reason || "not detected"}`);
          continue;
        }

        const linked = status.links.filter((link) => link.linked);
        if (linked.length === 0) {
          console.log("  no linked collections");
          continue;
        }

        for (const link of linked) {
          const desc = link.description ? ` | description: ${link.description}` : "";
          console.log(`  ${link.collection} -> ${link.connectionName} [linked]${desc}`);
        }
      }
      console.log("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to list MCP links: ${message}`);
      process.exit(1);
    }
  });
