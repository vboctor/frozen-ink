import { Command } from "commander";
import {
  ensureInitialized,
  getCollection,
  updateCollection,
} from "@frozenink/core";

export const updateCommand = new Command("update")
  .description("Update collection configuration")
  .argument("<collection>", "Collection name")
  .option("--open-only [value]", "Only sync open issues/PRs (true/false)")
  .option("--max <count>", "Maximum entities per type to sync", parseInt)
  .option("--max-issues <count>", "Maximum issues to sync", parseInt)
  .option("--max-prs <count>", "Maximum pull requests to sync", parseInt)
  .option("--sync-comments [value]", "Sync comments (true/false)")
  .option("--sync-check-statuses [value]", "Sync check statuses (true/false)")
  .option("--feed-url <url>", "RSS/Atom feed URL")
  .option("--site-url <url>", "RSS/Atom site URL")
  .option("--max-items <count>", "Maximum RSS/Atom items to sync", parseInt)
  .option("--sitemap-backfill [value]", "RSS/Atom sitemap backfill (true/false)")
  .option("--fetch-article-content [value]", "RSS/Atom article HTML fallback (true/false)")
  .addHelpText("after", `
Examples:
  # Switch to open issues/PRs only
  fink update my-repo --open-only

  # Set max entities to sync
  fink update my-repo --max 500

  # Enable comment syncing
  fink update my-repo --sync-comments true

  # Update RSS settings
  fink update my-blog --max-items 500 --sitemap-backfill true
`)
  .action(async (collection: string, opts: Record<string, unknown>) => {
    ensureInitialized();

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

    if (opts.feedUrl !== undefined) {
      config.feedUrl = opts.feedUrl;
      changes.push(`feedUrl: ${opts.feedUrl}`);
    }

    if (opts.siteUrl !== undefined) {
      config.siteUrl = opts.siteUrl;
      changes.push(`siteUrl: ${opts.siteUrl}`);
    }

    if (opts.maxItems !== undefined) {
      config.maxItems = opts.maxItems;
      changes.push(`maxItems: ${opts.maxItems}`);
    }

    if (opts.sitemapBackfill !== undefined) {
      const val = parseBool(opts.sitemapBackfill);
      if (val !== undefined) {
        config.sitemapBackfill = val;
        changes.push(`sitemapBackfill: ${val}`);
      }
    }

    if (opts.fetchArticleContent !== undefined) {
      const val = parseBool(opts.fetchArticleContent);
      if (val !== undefined) {
        config.fetchArticleContent = val;
        changes.push(`fetchArticleContent: ${val}`);
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
      console.log("  --feed-url <url>");
      console.log("  --site-url <url>");
      console.log("  --max-items <count>");
      console.log("  --sitemap-backfill [true|false]");
      console.log("  --fetch-article-content [true|false]");
      return;
    }

    updateCollection(collection, { config });
    console.log(`Updated "${collection}":`);
    for (const change of changes) {
      console.log(`  ${change}`);
    }
    console.log(`\nRun "fink sync ${collection} --full" to re-sync with new settings.`);
  });
