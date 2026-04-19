#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json";

const version: string = pkg.version;
import { initCommand } from "./commands/init";
import { addCommand } from "./commands/add";
import { syncCommand } from "./commands/sync";
import { statusCommand } from "./commands/status";
import { collectionsCommand } from "./commands/collections";
import { searchCommand } from "./commands/search";
import { configCommand } from "./commands/config";
import { indexCommand } from "./commands/index";
import { generateCommand } from "./commands/generate";
import { serveCommand } from "./commands/serve";
import { daemonCommand } from "./commands/daemon";
import { publishCommand } from "./commands/publish";
import { updateCommand } from "./commands/update";
import { unpublishCommand } from "./commands/unpublish";
import { tuiCommand } from "./commands/tui";
import { mcpCommand } from "./commands/mcp";
import { tableplusCommand } from "./commands/tableplus";
import { vscodeCommand } from "./commands/vscode";
import { cloneCommand } from "./commands/clone";

import { compactCommand } from "./commands/compact";
import { upgradeCommand } from "./commands/upgrade";
import { startTui } from "./tui/index";
import { notifyIfUpdateAvailable } from "./update-notifier";

const program = new Command();

notifyIfUpdateAvailable(version);

program
  .name("fink")
  .description("Frozen Ink - Local data replica manager")
  .version(version);

program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(updateCommand);
program.addCommand(syncCommand);
program.addCommand(statusCommand);
program.addCommand(collectionsCommand);
program.addCommand(searchCommand);
program.addCommand(configCommand);
program.addCommand(indexCommand);
program.addCommand(generateCommand);
program.addCommand(serveCommand);
program.addCommand(daemonCommand);
program.addCommand(publishCommand);
program.addCommand(unpublishCommand);
program.addCommand(tuiCommand);
program.addCommand(mcpCommand);
program.addCommand(tableplusCommand);
program.addCommand(vscodeCommand);
program.addCommand(cloneCommand);

program.addCommand(compactCommand);
program.addCommand(upgradeCommand);

// If no arguments passed (just "fink"), launch TUI by default
const args = process.argv.slice(2);
if (args.length === 0 && process.stdin.isTTY) {
  await startTui();
} else {
  await program.parseAsync();
}
