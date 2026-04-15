import { Command } from "commander";
import { createInterface } from "readline";
import {
  ensureInitialized,
  getCollection,
  clearCollectionPublishState,
} from "@frozenink/core";

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

export type UnpublishProgressCallback = (step: string, detail: string) => void;

/**
 * Core unpublish logic: delete Cloudflare resources (Worker, R2, D1) and
 * clear the collection's publish state.
 * Callable from both CLI and management API.
 */
export async function unpublishCollection(
  collectionName: string,
  onProgress: UnpublishProgressCallback = () => {},
): Promise<void> {
  const {
    checkWranglerAuth,
    deleteWorker,
    deleteR2Object,
    deleteR2Bucket,
    deleteR2Objects,
    listR2Objects,
    deleteD1,
  } = await import("./wrangler-api");

  await checkWranglerAuth();

  const workerName = collectionName;
  const d1DatabaseName = `${workerName}-db`;
  const r2BucketName = `${workerName}-files`;

  // 1. Empty and delete R2 bucket
  onProgress("r2", "Listing R2 objects...");
  try {
    const keys = await listR2Objects(r2BucketName);
    if (keys.length > 0) {
      onProgress("r2", `Deleting ${keys.length} objects from R2...`);
      await deleteR2Objects(r2BucketName, keys);
    }
    onProgress("r2", "Deleting R2 bucket...");
    await deleteR2Bucket(r2BucketName);
  } catch (err) {
    onProgress("r2", `Warning: could not fully clean R2 bucket "${r2BucketName}": ${err}`);
  }

  // 2. Delete D1 database
  onProgress("d1", "Deleting D1 database...");
  try {
    await deleteD1(d1DatabaseName);
  } catch (err) {
    onProgress("d1", `Warning: could not delete D1 database: ${err}`);
  }

  // 3. Delete worker
  onProgress("worker", `Deleting worker "${workerName}"...`);
  try {
    await deleteWorker(workerName);
  } catch (err) {
    onProgress("worker", `Warning: could not delete worker: ${err}`);
  }

  // 4. Clear publish state from collection config
  clearCollectionPublishState(collectionName);
  onProgress("done", `Collection "${collectionName}" unpublished`);
}

// --- CLI command ---

export const unpublishCommand = new Command("unpublish")
  .description("Remove a published collection from Cloudflare")
  .argument("<collection>", "Collection name to unpublish")
  .option("--force", "Skip confirmation")
  .action(async (collectionName: string, opts: {
    force?: boolean;
  }) => {
    try {
      ensureInitialized();

      const col = getCollection(collectionName);
      if (!col) {
        console.error(`Collection "${collectionName}" not found`);
        process.exit(1);
      }

      if (!opts.force) {
        const ok = await confirm(
          `This will delete the Cloudflare worker, D1 database, and R2 bucket for "${collectionName}" (if they exist). Continue?`,
        );
        if (!ok) {
          console.log("Cancelled");
          return;
        }
      }

      console.log(`Unpublishing "${collectionName}"...`);
      await unpublishCollection(collectionName, (step, detail) => {
        console.log(`  [${step}] ${detail}`);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nUnpublish failed: ${message}`);
      process.exit(1);
    }
  });
