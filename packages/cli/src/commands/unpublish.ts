import { Command } from "commander";
import { createInterface } from "readline";
import {
  ensureInitialized,
  getCollection,
  getCollectionPublishState,
  clearCollectionPublishState,
  type PublishState,
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
  publishState: PublishState,
  onProgress: UnpublishProgressCallback = () => {},
): Promise<void> {
  const {
    checkWranglerAuth,
    deleteWorker,
    deleteR2Object,
    deleteR2Bucket,
    deleteD1,
    executeD1Command,
  } = await import("./wrangler-api");

  await checkWranglerAuth();

  const workerName = collectionName;
  const d1DatabaseName = `${workerName}-db`;
  const r2BucketName = `${workerName}-files`;

  // 1. Delete worker
  onProgress("worker", `Deleting worker "${workerName}"...`);
  try {
    await deleteWorker(workerName);
  } catch (err) {
    onProgress("worker", `Warning: could not delete worker: ${err}`);
  }

  // 2. Try deleting R2 bucket (may fail if non-empty)
  onProgress("r2", "Deleting R2 bucket...");
  try {
    await deleteR2Bucket(r2BucketName);
  } catch {
    // Bucket may need to be emptied first — try manifest-based cleanup
    onProgress("r2", "R2 bucket not empty, emptying via manifest...");
    try {
      const manifestJson = await executeD1Command(d1DatabaseName, "SELECT key FROM r2_manifest");
      const parsed = JSON.parse(manifestJson);
      const results = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
      if (Array.isArray(results)) {
        for (const row of results as Array<{ key: string }>) {
          await deleteR2Object(r2BucketName, row.key);
        }
      }
      await deleteR2Bucket(r2BucketName);
      onProgress("r2", "R2 bucket deleted");
    } catch {
      onProgress("r2", `Warning: could not fully clean R2 bucket "${r2BucketName}". You may need to empty it via the Cloudflare dashboard.`);
    }
  }

  // 3. Delete D1 database
  onProgress("d1", "Deleting D1 database...");
  try {
    await deleteD1(d1DatabaseName);
  } catch (err) {
    onProgress("d1", `Warning: could not delete D1 database: ${err}`);
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

      const publishState = getCollectionPublishState(collectionName);
      if (!publishState) {
        console.error(`Collection "${collectionName}" is not published`);
        process.exit(1);
      }

      if (!opts.force) {
        const ok = await confirm(
          `This will delete the Cloudflare worker, D1 database, and R2 bucket for "${collectionName}". Continue?`,
        );
        if (!ok) {
          console.log("Cancelled");
          return;
        }
      }

      console.log(`Unpublishing "${collectionName}"...`);
      await unpublishCollection(collectionName, publishState, (step, detail) => {
        console.log(`  [${step}] ${detail}`);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nUnpublish failed: ${message}`);
      process.exit(1);
    }
  });
