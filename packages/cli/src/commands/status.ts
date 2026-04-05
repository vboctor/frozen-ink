import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  syncRuns,
} from "@veecontext/core";
import { desc } from "drizzle-orm";

export const statusCommand = new Command("status")
  .description("Show sync status for all collections")
  .action(() => {
    const home = getVeeContextHome();
    const masterDbPath = join(home, "master.db");

    if (!existsSync(masterDbPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const db = getMasterDb(masterDbPath);
    const collectionRows = db.select().from(collections).all();

    if (collectionRows.length === 0) {
      console.log("No collections configured. Run: vctx add <connector>");
      return;
    }

    for (const col of collectionRows) {
      const status = col.enabled ? "enabled" : "disabled";
      console.log(`\n${col.name} (${col.connectorType}) [${status}]`);

      if (!existsSync(col.dbPath)) {
        console.log("  Database not found");
        continue;
      }

      const colDb = getCollectionDb(col.dbPath);

      // Entity count
      const entityRows = colDb.select().from(entities).all();
      console.log(`  Entities: ${entityRows.length}`);

      // Last sync run
      const runs = colDb
        .select()
        .from(syncRuns)
        .orderBy(desc(syncRuns.startedAt))
        .limit(1)
        .all();

      if (runs.length > 0) {
        const run = runs[0];
        console.log(`  Last sync: ${run.startedAt} (${run.status})`);
        console.log(
          `  Created: ${run.entitiesCreated}, Updated: ${run.entitiesUpdated}, Deleted: ${run.entitiesDeleted}`,
        );
        if (run.errors && (run.errors as unknown[]).length > 0) {
          console.log(`  Errors: ${JSON.stringify(run.errors)}`);
        }
      } else {
        console.log("  No sync runs yet");
      }
    }
  });
