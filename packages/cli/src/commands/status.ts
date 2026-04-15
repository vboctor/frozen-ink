import { Command } from "commander";
import { existsSync } from "fs";
import {
  ensureInitialized,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  entities,
} from "@frozenink/core";

export const statusCommand = new Command("status")
  .description("Show sync status for all collections")
  .action(() => {
    ensureInitialized();

    const collectionRows = listCollections();

    if (collectionRows.length === 0) {
      console.log("No collections configured. Run: fink add <crawler>");
      return;
    }

    for (const col of collectionRows) {
      const status = col.enabled ? "enabled" : "disabled";
      console.log(`\n${col.name} (${col.crawler}) [${status}]`);

      const dbPath = getCollectionDbPath(col.name);
      if (!existsSync(dbPath)) {
        console.log("  Database not found");
        continue;
      }

      const colDb = getCollectionDb(dbPath);

      // Entity count
      const entityRows = colDb.select().from(entities).all();
      console.log(`  Entities: ${entityRows.length}`);

      // Last sync state (from collection YAML)
      if (col.lastSyncAt) {
        console.log(`  Last sync: ${col.lastSyncAt} (${col.lastSyncStatus})`);
        console.log(
          `  Created: ${col.lastSyncCreated ?? 0}, Updated: ${col.lastSyncUpdated ?? 0}, Deleted: ${col.lastSyncDeleted ?? 0}`,
        );
        if (col.lastSyncErrors && (col.lastSyncErrors as unknown[]).length > 0) {
          console.log(`  Errors: ${JSON.stringify(col.lastSyncErrors)}`);
        }
      } else {
        console.log("  No sync runs yet");
      }
    }
  });
