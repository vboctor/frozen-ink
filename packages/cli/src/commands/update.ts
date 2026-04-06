import { Command } from "commander";
import {
  contextExists,
  getCollection,
  updateCollection,
} from "@veecontext/core";

export const updateCommand = new Command("update")
  .description("Update collection configuration")
  .argument("<collection>", "Collection name")
  .option("--open-only [value]", "Only sync open issues/PRs (true/false)")
  .option("--max <count>", "Maximum entities per type to sync", parseInt)
  .option("--max-issues <count>", "Maximum issues to sync", parseInt)
  .option("--max-prs <count>", "Maximum pull requests to sync", parseInt)
  .option("--sync-comments [value]", "Sync comments (true/false)")
  .option("--sync-check-statuses [value]", "Sync check statuses (true/false)")
  .action(async (collection: string, opts: Record<string, unknown>) => {
    if (!contextExists()) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const col = getCollection(collection);
    if (!col) {
      console.error(`Collection "${collection}" not found`);
      process.exit(1);
    }

    const config = { ...(col.config as Record<string, unknown>) };
    const changes: string[] = [];

    function parseBool(value: unknown): boolean | undefined {
      if (value === true || value === "true") return true;
      if (value === "false") return false;
      return undefined;
    }

    if (opts.openOnly !== undefined) {
      const val = parseBool(opts.openOnly);
      if (val !== undefined) {
        config.openOnly = val;
        changes.push(`openOnly: ${val}`);
      }
    }

    if (opts.max !== undefined) {
      config.maxIssues = opts.max;
      config.maxPullRequests = opts.max;
      // Clear global maxEntities to avoid it capping the per-type limits
      delete config.maxEntities;
      changes.push(`maxIssues: ${opts.max}`);
      changes.push(`maxPullRequests: ${opts.max}`);
    }

    if (opts.maxIssues !== undefined) {
      config.maxIssues = opts.maxIssues;
      changes.push(`maxIssues: ${opts.maxIssues}`);
    }

    if (opts.maxPrs !== undefined) {
      config.maxPullRequests = opts.maxPrs;
      changes.push(`maxPullRequests: ${opts.maxPrs}`);
    }

    if (opts.syncComments !== undefined) {
      const val = parseBool(opts.syncComments);
      if (val !== undefined) {
        config.syncComments = val;
        changes.push(`syncComments: ${val}`);
      }
    }

    if (opts.syncCheckStatuses !== undefined) {
      const val = parseBool(opts.syncCheckStatuses);
      if (val !== undefined) {
        config.syncCheckStatuses = val;
        changes.push(`syncCheckStatuses: ${val}`);
      }
    }

    if (changes.length === 0) {
      console.log("No changes specified. Available options:");
      console.log("  --open-only [true|false]");
      console.log("  --max <count>");
      console.log("  --max-issues <count>");
      console.log("  --max-prs <count>");
      console.log("  --sync-comments [true|false]");
      console.log("  --sync-check-statuses [true|false]");
      return;
    }

    updateCollection(collection, { config });
    console.log(`Updated "${collection}":`);
    for (const change of changes) {
      console.log(`  ${change}`);
    }
    console.log(`\nRun "vctx sync ${collection} --full" to re-sync with new settings.`);
  });
