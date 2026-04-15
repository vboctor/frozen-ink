import { Command } from "commander";
import { existsSync } from "fs";
import {
  ensureInitialized,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  entities,
  collectionState,
} from "@frozenink/core";
import { eq } from "drizzle-orm";

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

      // Last sync state
      const [state] = colDb
        .select()
        .from(collectionState)
        .where(eq(collectionState.id, 1))
        .all();

      if (state?.lastSyncAt) {
        console.log(`  Last sync: ${state.lastSyncAt} (${state.lastSyncStatus})`);
        console.log(
          `  Created: ${state.lastSyncCreated}, Updated: ${state.lastSyncUpdated}, Deleted: ${state.lastSyncDeleted}`,
        );
        if (state.lastSyncErrors && (state.lastSyncErrors as unknown[]).length > 0) {
          console.log(`  Errors: ${JSON.stringify(state.lastSyncErrors)}`);
        }
      } else {
        console.log("  No sync runs yet");
      }
    }
  });
