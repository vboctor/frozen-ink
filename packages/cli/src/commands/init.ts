import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getFrozenInkHome, defaultConfig, saveContext } from "@frozenink/core";

export const initCommand = new Command("init")
  .description("Initialize Frozen Ink directory and configuration")
  .action(() => {
    const home = getFrozenInkHome();

    if (existsSync(join(home, "context.yml"))) {
      console.log(`Frozen Ink already initialized at ${home}`);
      return;
    }

    // Create home directory
    mkdirSync(home, { recursive: true });

    // Create config.json with defaults
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify(defaultConfig, null, 2),
    );

    // Create context.yml with empty collections
    saveContext({ collections: {}, deployments: {} });

    // Create collections directory
    mkdirSync(join(home, "collections"), { recursive: true });

    console.log(`Initialized Frozen Ink at ${home}`);
    console.log(`  config.json  - configuration`);
    console.log(`  context.yml  - collection registry`);
    console.log(`  collections/ - collection data`);
  });
