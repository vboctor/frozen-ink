import { Command } from "commander";
import { existsSync, statSync } from "fs";
import {
  ensureInitialized,
  listCollections,
  getCollection,
  getCollectionDbPath,
  openDatabase,
} from "@frozenink/core";

function getDbSizeBytes(dbPath: string): number {
  let total = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) {
      total += statSync(p).size;
    }
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const compactCommand = new Command("compact")
  .description("Vacuum the SQLite database to reclaim unused space")
  .argument("<collection>", 'Collection name or "*" for all collections')
  .addHelpText("after", `
Examples:
  fink compact my-vault
  fink compact "*"
`)
  .action(async (collection: string) => {
    ensureInitialized();

    let collectionRows =
      collection === "*"
        ? listCollections()
        : (() => {
            const col = getCollection(collection);
            if (!col) {
              console.error(`Collection "${collection}" not found`);
              process.exit(1);
            }
            return [col];
          })();

    collectionRows = collectionRows.filter((c) => c.enabled);

    if (collectionRows.length === 0) {
      console.log("No enabled collections to compact");
      return;
    }

    for (const col of collectionRows) {
      const dbPath = getCollectionDbPath(col.name);
      if (!existsSync(dbPath)) {
        console.log(`${col.name}: no database found, skipping`);
        continue;
      }

      const sizeBefore = getDbSizeBytes(dbPath);
      console.log(`Compacting "${col.name}" (${formatBytes(sizeBefore)})...`);

      const sqlite = openDatabase(dbPath);
      try {
        // Flush WAL into the main database file before vacuuming
        sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        sqlite.exec("VACUUM;");
      } finally {
        sqlite.close();
      }

      const sizeAfter = getDbSizeBytes(dbPath);
      const saved = sizeBefore - sizeAfter;
      if (saved > 0) {
        console.log(
          `  Done. ${formatBytes(sizeAfter)} (saved ${formatBytes(saved)})`,
        );
      } else {
        console.log(`  Done. ${formatBytes(sizeAfter)} (no space reclaimed)`);
      }
    }
  });
