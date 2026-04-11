import { Command } from "commander";
import { startTui } from "../tui/index.js";

export const tuiCommand = new Command("tui")
  .description("Launch the interactive TUI interface")
  .action(async () => {
    await startTui();
  });
