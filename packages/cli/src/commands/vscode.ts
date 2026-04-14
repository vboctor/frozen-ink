import { Command } from "commander";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { getFrozenInkHome, ensureInitialized, getCollection } from "@frozenink/core";

export const vscodeCommand = new Command("vscode")
  .description("Open a collection folder in VS Code (defaults to ~/.frozenink)")
  .argument("[collection]", "Collection name (optional)")
  .action((collection?: string) => {
    const home = getFrozenInkHome();

    let folderPath: string;

    if (collection) {
      ensureInitialized();

      const col = getCollection(collection);
      if (!col) {
        console.error(`Collection "${collection}" not found`);
        process.exit(1);
      }

      folderPath = join(home, "collections", collection);
      if (!existsSync(folderPath)) {
        console.error(`Collection folder not found at ${folderPath}`);
        process.exit(1);
      }
    } else {
      folderPath = home;
    }

    execSync(`code "${folderPath}"`);
  });
