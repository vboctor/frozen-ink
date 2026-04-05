import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getVeeContextHome, defaultConfig, getMasterDb } from "@veecontext/core";

export const initCommand = new Command("init")
  .description("Initialize VeeContext directory and configuration")
  .action(() => {
    const home = getVeeContextHome();

    if (existsSync(join(home, "config.json"))) {
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

    // Create master database
    const masterDbPath = join(home, "master.db");
    getMasterDb(masterDbPath);

    // Create collections directory
    mkdirSync(join(home, "collections"), { recursive: true });

    console.log(`Initialized VeeContext at ${home}`);
    console.log(`  config.json - configuration`);
    console.log(`  master.db   - collection registry`);
    console.log(`  collections/ - collection data`);
  });
