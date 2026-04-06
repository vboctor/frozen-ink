import { Command } from "commander";
import { existsSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import {
  getVeeContextHome,
  isValidCollectionKey,
  contextExists,
  getMasterDb,
  getMasterDbPath,
  collections,
} from "@veecontext/core";

function requireInit(): void {
  if (!contextExists()) {
    console.error("VeeContext not initialized. Run: vctx init");
    process.exit(1);
  }
}

function displayName(col: { name: string; title?: string | null }): string {
  return col.title ? `${col.title} (${col.name})` : col.name;
}

const listCommand = new Command("list")
  .description("List all collections")
  .action(() => {
    requireInit();
    const db = getMasterDb(getMasterDbPath());
    const cols = db.select().from(collections).all();

    if (cols.length === 0) {
      console.log("No collections configured");
      return;
    }

    for (const col of cols) {
      const status = col.enabled ? "enabled" : "disabled";
      const title = col.title ? ` — ${col.title}` : "";
      console.log(`${col.name}${title} (${col.crawlerType}) [${status}]`);
    }
  });

const removeCommand = new Command("remove")
  .description("Remove a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    requireInit();
    const db = getMasterDb(getMasterDbPath());
    const [col] = db
      .select()
      .from(collections)
      .where(eq(collections.name, key))
      .all();

    if (!col) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    // Remove collection directory
    const home = getVeeContextHome();
    const collectionDir = join(home, "collections", key);
    if (existsSync(collectionDir)) {
      rmSync(collectionDir, { recursive: true, force: true });
    }

    db.delete(collections).where(eq(collections.name, key)).run();
    console.log(`Collection "${displayName(col)}" removed`);
  });

const enableCommand = new Command("enable")
  .description("Enable a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    requireInit();
    const db = getMasterDb(getMasterDbPath());
    const [col] = db
      .select()
      .from(collections)
      .where(eq(collections.name, key))
      .all();

    if (!col) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    db.update(collections)
      .set({ enabled: true })
      .where(eq(collections.name, key))
      .run();
    console.log(`Collection "${displayName(col)}" enabled`);
  });

const disableCommand = new Command("disable")
  .description("Disable a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    requireInit();
    const db = getMasterDb(getMasterDbPath());
    const [col] = db
      .select()
      .from(collections)
      .where(eq(collections.name, key))
      .all();

    if (!col) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    db.update(collections)
      .set({ enabled: false })
      .where(eq(collections.name, key))
      .run();
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
    const home = getVeeContextHome();
    const db = getMasterDb(getMasterDbPath());
    const [col] = db
      .select()
      .from(collections)
      .where(eq(collections.name, oldKey))
      .all();

    if (!col) {
      console.error(`Collection "${oldKey}" not found`);
      process.exit(1);
    }

    // Check new key doesn't conflict
    const [existing] = db
      .select()
      .from(collections)
      .where(eq(collections.name, newKey))
      .all();
    if (existing) {
      console.error(`Collection "${newKey}" already exists`);
      process.exit(1);
    }

    // Rename the directory
    const oldDir = join(home, "collections", oldKey);
    const newDir = join(home, "collections", newKey);
    if (existsSync(oldDir)) {
      renameSync(oldDir, newDir);
    }

    db.update(collections)
      .set({ name: newKey })
      .where(eq(collections.name, oldKey))
      .run();
    console.log(`Collection renamed: "${oldKey}" → "${newKey}"`);
  });

const updateCommand = new Command("update")
  .description("Update collection settings")
  .argument("<key>", "Collection key")
  .option("--title <title>", "Set display title")
  .option("--include-diffs", "Enable commit diffs (git collections)")
  .option("--no-include-diffs", "Disable commit diffs (git collections)")
  .action((key: string, opts: { title?: string; includeDiffs?: boolean }) => {
    requireInit();
    const db = getMasterDb(getMasterDbPath());
    const [col] = db
      .select()
      .from(collections)
      .where(eq(collections.name, key))
      .all();

    if (!col) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    const changes: string[] = [];

    if (opts.title !== undefined) {
      db.update(collections)
        .set({ title: opts.title })
        .where(eq(collections.name, key))
        .run();
      changes.push(`title → "${opts.title}"`);
    }

    if (opts.includeDiffs !== undefined) {
      const config = { ...(col.config ?? {}) };
      config.includeDiffs = opts.includeDiffs;
      db.update(collections)
        .set({ config })
        .where(eq(collections.name, key))
        .run();
      changes.push(`includeDiffs → ${opts.includeDiffs}`);
    }

    if (changes.length === 0) {
      console.log("Nothing to update. Use --title or --include-diffs.");
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
