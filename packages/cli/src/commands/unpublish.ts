import { Command } from "commander";
import { createInterface } from "readline";
import {
  ensureInitialized,
  getSite,
  removeSite,
  type SiteEntry,
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
 * remove the deployment from context.yml.
 * Callable from both CLI and management API.
 */
export async function unpublishDeployment(
  deployment: SiteEntry & { name: string },
  onProgress: UnpublishProgressCallback = () => {},
): Promise<void> {
  const {
    checkWranglerAuth,
    deleteWorker,
    deleteR2Object,
    deleteR2Bucket,
    deleteD1,
    listR2Objects,
  } = await import("./wrangler-api");

  await checkWranglerAuth();

  // 1. Delete worker
  onProgress("worker", `Deleting worker "${deployment.name}"...`);
  try {
    await deleteWorker(deployment.name);
  } catch (err) {
    onProgress("worker", `Warning: could not delete worker: ${err}`);
  }

  // 2. Try deleting R2 bucket (may fail if non-empty)
  const r2BucketName = deployment.bucket.name;
  onProgress("r2", "Deleting R2 bucket...");
  try {
    await deleteR2Bucket(r2BucketName);
  } catch {
    // Bucket may need to be emptied first — list and delete all objects
    onProgress("r2", "R2 bucket not empty, emptying via R2 list...");
    try {
      const keys = await listR2Objects(r2BucketName);
      for (const key of keys) {
        await deleteR2Object(r2BucketName, key);
      }
      await deleteR2Bucket(r2BucketName);
      onProgress("r2", "R2 bucket deleted");
    } catch {
      onProgress("r2", `Warning: could not fully clean R2 bucket "${r2BucketName}". You may need to empty it via the Cloudflare dashboard.`);
    }
  }

  // 3. Delete D1 database
  const d1Name = deployment.database.name || `${deployment.name}-db`;
  onProgress("d1", "Deleting D1 database...");
  try {
    await deleteD1(d1Name);
  } catch (err) {
    onProgress("d1", `Warning: could not delete D1 database: ${err}`);
  }

  // 4. Remove site directory
  removeSite(deployment.name);
  onProgress("done", `Site "${deployment.name}" removed`);
}

// --- CLI command ---

export const unpublishCommand = new Command("unpublish")
  .description("Remove a published deployment from Cloudflare")
  .argument("<name-or-url>", "Worker name or URL of the site")
  .option("--force", "Skip confirmation")
  .action(async (nameOrUrl: string, opts: {
    force?: boolean;
  }) => {
    try {
      ensureInitialized();

      const deployment = getSite(nameOrUrl);
      if (!deployment) {
        console.error(`Site "${nameOrUrl}" not found`);
        process.exit(1);
      }

      if (!opts.force) {
        const ok = await confirm(
          `This will delete worker "${deployment.name}", its D1 database, and R2 bucket. Continue?`,
        );
        if (!ok) {
          console.log("Cancelled");
          return;
        }
      }

      console.log(`Unpublishing "${deployment.name}"...`);
      await unpublishDeployment(deployment, (step, detail) => {
        console.log(`  [${step}] ${detail}`);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nUnpublish failed: ${message}`);
      process.exit(1);
    }
  });
