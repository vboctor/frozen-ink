import { Command } from "commander";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { ensureInitialized, getCollection, getCollectionDbPath } from "@frozenink/core";

export const tableplusCommand = new Command("tableplus")
  .description("Open a collection's SQLite database in TablePlus")
  .argument("<collection>", "Collection name")
  .action((collection: string) => {
    ensureInitialized();

    const col = getCollection(collection);
    if (!col) {
      console.error(`Collection "${collection}" not found`);
      process.exit(1);
    }

    const dbPath = getCollectionDbPath(collection);
    if (!existsSync(dbPath)) {
      console.error(`Database not found at ${dbPath}`);
      process.exit(1);
    }

    execSync(`open -a TablePlus "${dbPath}"`);
  });
