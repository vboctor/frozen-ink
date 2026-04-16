import { Command } from "commander";
import { existsSync } from "fs";
import {
  ensureInitialized,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  getCollectionSyncState,
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

      // Last sync state from the DB metadata table
      const sync = getCollectionSyncState(dbPath);
      if (sync.lastAt) {
        console.log(`  Last sync: ${sync.lastAt} (${sync.lastStatus})`);
        console.log(
          `  Created: ${sync.lastCreated ?? 0}, Updated: ${sync.lastUpdated ?? 0}, Deleted: ${sync.lastDeleted ?? 0}`,
        );
        if (sync.lastErrors && sync.lastErrors.length > 0) {
          console.log(`  Errors: ${JSON.stringify(sync.lastErrors)}`);
        }
      } else {
        console.log("  No sync runs yet");
      }
    }
  });
