import { Command } from "commander";
import { existsSync, rmSync } from "fs";
import { dirname, join } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  collections,
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
      console.log(`${row.name} (${row.connectorType}) [${status}]`);
    }
  });

const removeCommand = new Command("remove")
  .description("Remove a collection")
  .argument("<name>", "Collection name")
  .action((name: string) => {
    const masterDbPath = requireInit();
    const db = getMasterDb(masterDbPath);
    const [row] = db
      .select()
      .from(collections)
      .where(eq(collections.name, name))
      .all();

    if (!row) {
      console.error(`Collection "${name}" not found`);
      process.exit(1);
    }

    // Remove collection directory
    const collectionDir = dirname(row.dbPath);
    if (existsSync(collectionDir)) {
      rmSync(collectionDir, { recursive: true, force: true });
    }

    db.delete(collections).where(eq(collections.id, row.id)).run();
    console.log(`Collection "${name}" removed`);
  });

const enableCommand = new Command("enable")
  .description("Enable a collection")
  .argument("<name>", "Collection name")
  .action((name: string) => {
    const masterDbPath = requireInit();
    const db = getMasterDb(masterDbPath);
    const [row] = db
      .select()
      .from(collections)
      .where(eq(collections.name, name))
      .all();

    if (!row) {
      console.error(`Collection "${name}" not found`);
      process.exit(1);
    }

    db.update(collections)
      .set({ enabled: true })
      .where(eq(collections.id, row.id))
      .run();
    console.log(`Collection "${name}" enabled`);
  });

const disableCommand = new Command("disable")
  .description("Disable a collection")
  .argument("<name>", "Collection name")
  .action((name: string) => {
    const masterDbPath = requireInit();
    const db = getMasterDb(masterDbPath);
    const [row] = db
      .select()
      .from(collections)
      .where(eq(collections.name, name))
      .all();

    if (!row) {
      console.error(`Collection "${name}" not found`);
      process.exit(1);
    }

    db.update(collections)
      .set({ enabled: false })
      .where(eq(collections.id, row.id))
      .run();
    console.log(`Collection "${name}" disabled`);
  });

export const collectionsCommand = new Command("collections")
  .description("Manage collections")
  .addCommand(listCommand)
  .addCommand(removeCommand)
  .addCommand(enableCommand)
  .addCommand(disableCommand);
