import { Command } from "commander";
import { existsSync, renameSync, rmSync } from "fs";
import { dirname, join } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  collections,
  isValidCollectionKey,
} from "@veecontext/core";
import { eq } from "drizzle-orm";

function requireInit(): string {
  const home = getVeeContextHome();
  const masterDbPath = join(home, "master.db");
  if (!existsSync(masterDbPath)) {
    console.error("VeeContext not initialized. Run: vctx init");
    process.exit(1);
  }
  return masterDbPath;
}

function displayName(row: { name: string; title: string | null }): string {
  return row.title ? `${row.title} (${row.name})` : row.name;
}

const listCommand = new Command("list")
  .description("List all collections")
  .action(() => {
    const masterDbPath = requireInit();
    const db = getMasterDb(masterDbPath);
    const rows = db.select().from(collections).all();

    if (rows.length === 0) {
      console.log("No collections configured");
      return;
    }

    for (const row of rows) {
      const status = row.enabled ? "enabled" : "disabled";
      const title = row.title ? ` — ${row.title}` : "";
      console.log(`${row.name}${title} (${row.crawlerType}) [${status}]`);
    }
  });

const removeCommand = new Command("remove")
  .description("Remove a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    const masterDbPath = requireInit();
    const db = getMasterDb(masterDbPath);
    const [row] = db
      .select()
      .from(collections)
      .where(eq(collections.name, key))
      .all();

    if (!row) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    // Remove collection directory
    const collectionDir = dirname(row.dbPath);
    if (existsSync(collectionDir)) {
      rmSync(collectionDir, { recursive: true, force: true });
    }

    db.delete(collections).where(eq(collections.id, row.id)).run();
    console.log(`Collection "${displayName(row)}" removed`);
  });

const enableCommand = new Command("enable")
  .description("Enable a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    const masterDbPath = requireInit();
    const db = getMasterDb(masterDbPath);
    const [row] = db
      .select()
      .from(collections)
      .where(eq(collections.name, key))
      .all();

    if (!row) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    db.update(collections)
      .set({ enabled: true })
      .where(eq(collections.id, row.id))
      .run();
    console.log(`Collection "${displayName(row)}" enabled`);
  });

const disableCommand = new Command("disable")
  .description("Disable a collection")
  .argument("<key>", "Collection key")
  .action((key: string) => {
    const masterDbPath = requireInit();
    const db = getMasterDb(masterDbPath);
    const [row] = db
      .select()
      .from(collections)
      .where(eq(collections.name, key))
      .all();

    if (!row) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    db.update(collections)
      .set({ enabled: false })
      .where(eq(collections.id, row.id))
      .run();
    console.log(`Collection "${displayName(row)}" disabled`);
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

    const masterDbPath = requireInit();
    const home = getVeeContextHome();
    const db = getMasterDb(masterDbPath);
    const [row] = db
      .select()
      .from(collections)
      .where(eq(collections.name, oldKey))
      .all();

    if (!row) {
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

    // Update DB path and name
    const newDbPath = join(newDir, "data.db");
    db.update(collections)
      .set({ name: newKey, dbPath: newDbPath })
      .where(eq(collections.id, row.id))
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
    const masterDbPath = requireInit();
    const db = getMasterDb(masterDbPath);
    const [row] = db
      .select()
      .from(collections)
      .where(eq(collections.name, key))
      .all();

    if (!row) {
      console.error(`Collection "${key}" not found`);
      process.exit(1);
    }

    const updates: Record<string, unknown> = {};
    const changes: string[] = [];

    if (opts.title !== undefined) {
      updates.title = opts.title;
      changes.push(`title → "${opts.title}"`);
    }

    if (opts.includeDiffs !== undefined) {
      const config = (row.config as Record<string, unknown>) ?? {};
      config.includeDiffs = opts.includeDiffs;
      updates.config = config;
      changes.push(`includeDiffs → ${opts.includeDiffs}`);
    }

    if (changes.length === 0) {
      console.log("Nothing to update. Use --title or --include-diffs.");
      return;
    }

    db.update(collections)
      .set(updates)
      .where(eq(collections.id, row.id))
      .run();
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
