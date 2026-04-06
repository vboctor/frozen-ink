import { Command } from "commander";
import { existsSync } from "fs";
import {
  contextExists,
  getMasterDb,
  getMasterDbPath,
  collections,
  getCollectionDb,
  entities,
  syncRuns,
} from "@veecontext/core";
import { desc } from "drizzle-orm";

export const statusCommand = new Command("status")
  .description("Show sync status for all collections")
  .action(() => {
    if (!contextExists()) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const masterDb = getMasterDb(getMasterDbPath());
    const collectionRows = masterDb.select().from(collections).all();

    if (collectionRows.length === 0) {
      console.log("No collections configured. Run: vctx add <crawler>");
      return;
    }

    for (const col of collectionRows) {
      const status = col.enabled ? "enabled" : "disabled";
      console.log(`\n${col.name} (${col.crawlerType}) [${status}]`);

      const dbPath = col.dbPath;
      if (!existsSync(dbPath)) {
        console.log("  Database not found");
        continue;
      }

      const colDb = getCollectionDb(dbPath);

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
