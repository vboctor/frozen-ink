#!/usr/bin/env bun
import { Command } from "commander";
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

const program = new Command();

program
  .name("vctx")
  .description("VeeContext - Local data replica manager")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(syncCommand);
program.addCommand(statusCommand);
program.addCommand(collectionsCommand);
program.addCommand(searchCommand);
program.addCommand(configCommand);
program.addCommand(indexCommand);
program.addCommand(generateCommand);
program.addCommand(serveCommand);
program.addCommand(daemonCommand);

program.parse();
