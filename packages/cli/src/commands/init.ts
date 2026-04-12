import { Command } from "commander";
import { getFrozenInkHome, ensureInitialized } from "@frozenink/core";

export const initCommand = new Command("init")
  .description("Initialize Frozen Ink directory and configuration")
  .action(() => {
    const home = getFrozenInkHome();
    ensureInitialized();
    console.log(`Frozen Ink initialized at ${home}`);
  });
