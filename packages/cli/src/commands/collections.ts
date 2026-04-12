import { Command } from "commander";
import { existsSync, renameSync, rmSync } from "fs";
import { join } from "path";
import {
  getFrozenInkHome,
  isValidCollectionKey,
  ensureInitialized,
  listCollections,
  getCollection,
  removeCollection,
  updateCollection,
  renameCollection,
  getCollectionDbPath,
} from "@frozenink/core";

function requireInit(): void {
  ensureInitialized();
}

function displayName(col: { name: string; title?: string }): string {
  return col.title ? `${col.title} (${col.name})` : col.name;
}

const listCommand = new Command("list")
  .description("List all collections")
  .action(() => {
    requireInit();
    const cols = listCollections();

    if (cols.length === 0) {
      console.log("No collections configured");
      return;
    }

    for (const col of cols) {
      const status = col.enabled ? "enabled" : "disabled";
      const title = col.title ? ` — ${col.title}` : "";
      console.log(`${col.name}${title} (${col.crawler}) [${status}]`);
    }
  });

const removeCommand = new Command("remove")
  .description("Remove a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    requireInit();
    const col = getCollection(key);

    if (!col) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    // Remove collection directory
    const home = getFrozenInkHome();
    const collectionDir = join(home, "collections", key);
    if (existsSync(collectionDir)) {
      rmSync(collectionDir, { recursive: true, force: true });
    }

    removeCollection(key);
    console.log(`Collection "${displayName(col)}" removed`);
  });

const enableCommand = new Command("enable")
  .description("Enable a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    requireInit();
    const col = getCollection(key);

    if (!col) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    updateCollection(key, { enabled: true });
    console.log(`Collection "${displayName(col)}" enabled`);
  });

const disableCommand = new Command("disable")
  .description("Disable a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    requireInit();
    const col = getCollection(key);

    if (!col) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    updateCollection(key, { enabled: false });
    console.log(`Collection "${displayName(col)}" disabled`);
  });

const renameCommand = new Command("rename")
  .description("Rename a collection key")
  .argument("<old-key>", "Current collection key")
  .argument("<new-key>", "New collection key")
  .action((oldKey: string, newKey: string) => {
    if (!isValidCollectionKey(newKey)) {
      console.error(
        `Invalid collection key "${newKey}". Keys must contain only letters, numbers, dashes, and underscores.`,
      );
      process.exit(1);
    }

    requireInit();
    const home = getFrozenInkHome();
    const col = getCollection(oldKey);

    if (!col) {
      console.error(`Collection "${oldKey}" not found`);
      process.exit(1);
    }

    // Check new key doesn't conflict
    if (getCollection(newKey)) {
      console.error(`Collection "${newKey}" already exists`);
      process.exit(1);
    }

    // Rename the directory
    const oldDir = join(home, "collections", oldKey);
    const newDir = join(home, "collections", newKey);
    if (existsSync(oldDir)) {
      renameSync(oldDir, newDir);
    }

    renameCollection(oldKey, newKey);
    console.log(`Collection renamed: "${oldKey}" → "${newKey}"`);
  });

const updateCommand = new Command("update")
  .description("Update collection settings")
  .argument("<key>", "Collection key")
  .option("--title <title>", "Set display title")
  .option("--description <text>", "Set description of what this collection contains (helps AI know when to use it)")
  .option("--include-diffs", "Enable commit diffs (git collections)")
  .option("--no-include-diffs", "Disable commit diffs (git collections)")
  .action((key: string, opts: { title?: string; description?: string; includeDiffs?: boolean }) => {
    requireInit();
    const col = getCollection(key);

    if (!col) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    const changes: string[] = [];

    if (opts.title !== undefined) {
      updateCollection(key, { title: opts.title });
      changes.push(`title → "${opts.title}"`);
    }

    if (opts.description !== undefined) {
      updateCollection(key, { description: opts.description });
      changes.push(`description updated`);
    }

    if (opts.includeDiffs !== undefined) {
      const config = { ...(col.config ?? {}) };
      config.includeDiffs = opts.includeDiffs;
      updateCollection(key, { config });
      changes.push(`includeDiffs → ${opts.includeDiffs}`);
    }

    if (changes.length === 0) {
      console.log("Nothing to update. Use --title, --description, or --include-diffs.");
      return;
    }

    console.log(`Updated "${key}": ${changes.join(", ")}`);
  });

export const collectionsCommand = new Command("collections")
  .description("Manage collections")
  .addCommand(listCommand)
  .addCommand(removeCommand)
  .addCommand(enableCommand)
  .addCommand(disableCommand)
  .addCommand(renameCommand)
  .addCommand(updateCommand);
