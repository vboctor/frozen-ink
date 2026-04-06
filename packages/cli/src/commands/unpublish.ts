import { Command } from "commander";
import { createInterface } from "readline";
import {
  contextExists,
  getDeployment,
  removeDeployment,
} from "@veecontext/core";
import {
  checkWranglerAuth,
  deleteWorker,
  deleteR2Object,
  deleteR2Bucket,
  deleteD1,
  executeD1Command,
  WranglerError,
} from "./wrangler-api";

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

export const unpublishCommand = new Command("unpublish")
  .description("Remove a published deployment from Cloudflare")
  .argument("<name-or-url>", "Worker name or URL of the deployment")
  .option("--force", "Skip confirmation")
  .action(async (nameOrUrl: string, opts: {
    force?: boolean;
  }) => {
    try {
    if (!contextExists()) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const deployment = getDeployment(nameOrUrl);
    if (!deployment) {
      console.error(`Deployment "${nameOrUrl}" not found`);
      process.exit(1);
    }

    await checkWranglerAuth();

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

    // 1. Delete worker
    try {
      console.log("  Deleting worker...");
      await deleteWorker(deployment.name);
    } catch (err) {
      console.warn(`  Warning: could not delete worker: ${err}`);
    }

    // 2. Try deleting R2 bucket (may fail if non-empty)
    const r2BucketName = deployment.r2BucketName;
    try {
      console.log("  Deleting R2 bucket...");
      await deleteR2Bucket(r2BucketName);
    } catch {
      // Bucket may need to be emptied first — try manifest-based cleanup
      console.log("  R2 bucket not empty, emptying via manifest...");
      const d1Name = deployment.d1DatabaseName || `${deployment.name}-db`;
      try {
        const manifestJson = await executeD1Command(d1Name, "SELECT key FROM r2_manifest");
        const parsed = JSON.parse(manifestJson);
        const results = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
        if (Array.isArray(results)) {
          for (const row of results as Array<{ key: string }>) {
            await deleteR2Object(r2BucketName, row.key);
          }
        }
        // Retry bucket delete
        await deleteR2Bucket(r2BucketName);
        console.log("  R2 bucket deleted");
      } catch (err2) {
        console.warn(`  Warning: could not fully clean R2 bucket "${r2BucketName}". You may need to empty it via the Cloudflare dashboard.`);
      }
    }

    // 3. Delete D1 database
    try {
      const d1Name = deployment.d1DatabaseName || `${deployment.name}-db`;
      console.log("  Deleting D1 database...");
      await deleteD1(d1Name);
    } catch (err) {
      console.warn(`  Warning: could not delete D1 database: ${err}`);
    }

    // 4. Remove from context.yml
    removeDeployment(deployment.name);

    console.log(`\nDeployment "${deployment.name}" removed`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nUnpublish failed: ${message}`);
      process.exit(1);
    }
  });
