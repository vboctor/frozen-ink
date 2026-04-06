import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getVeeContextHome, defaultConfig, saveContext, getMasterDb } from "@veecontext/core";

export const initCommand = new Command("init")
  .description("Initialize VeeContext directory and configuration")
  .action(() => {
    const home = getVeeContextHome();

    if (existsSync(join(home, "context.yml"))) {
      console.log(`VeeContext already initialized at ${home}`);
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

    // Initialize master.db (creates file + schema)
    getMasterDb(join(home, "master.db"));

    console.log(`Initialized VeeContext at ${home}`);
    console.log(`  config.json  - configuration`);
    console.log(`  context.yml  - collection registry`);
    console.log(`  master.db    - master database`);
    console.log(`  collections/ - collection data`);
  });
