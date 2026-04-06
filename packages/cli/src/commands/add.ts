import { Command } from "commander";
import { mkdirSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getCollectionDb,
  isValidCollectionKey,
  contextExists,
  getCollection,
  addCollection,
  getCollectionDbPath,
} from "@veecontext/core";
import { createDefaultRegistry } from "@veecontext/crawlers";

export const addCommand = new Command("add")
  .description("Add a new collection")
  .argument("<crawler>", "Crawler type (e.g., github)")
  .requiredOption("--name <key>", "Collection key (alphanumeric, dash, underscore)")
  .option("--title <title>", "Display title for the collection")
  .option("--token <token>", "Authentication token")
  .option("--repo <repo>", "Repository in owner/repo format (for github)")
  .option("--path <path>", "Path to local directory (for obsidian, git)")
  .option("--include-diffs", "Include commit diffs (for git)")
  .option("--url <url>", "Base URL (for mantisbt)")
  .option("--project-id <id>", "Project ID (for mantisbt)", parseInt)
  .option("--max <count>", "Maximum entities per type to sync (applies to issues and PRs independently)", parseInt)
  .option("--max-issues <count>", "Maximum issues to sync (for github)", parseInt)
  .option("--max-prs <count>", "Maximum pull requests to sync (for github)", parseInt)
  .option("--open-only", "Only sync open issues/PRs, delete closed ones (for github)")
  .action(async (crawlerType: string, opts: Record<string, string>) => {
    if (!contextExists()) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    if (!isValidCollectionKey(opts.name)) {
      console.error(
        `Invalid collection key "${opts.name}". Keys must contain only letters, numbers, dashes, and underscores.`,
      );
      process.exit(1);
    }

    if (getCollection(opts.name)) {
      console.error(`Collection "${opts.name}" already exists`);
      process.exit(1);
    }

    const registry = createDefaultRegistry();
    if (!registry.has(crawlerType)) {
      console.error(
        `Unknown crawler type: ${crawlerType}. Available: ${registry.getRegisteredTypes().join(", ")}`,
      );
      process.exit(1);
    }

    // Build credentials and config based on crawler type
    const credentials: Record<string, unknown> = {};
    const config: Record<string, unknown> = {};

    if (crawlerType === "github") {
      if (!opts.token || !opts.repo) {
        console.error(
          "GitHub crawler requires --token and --repo (in owner/repo format)",
        );
        process.exit(1);
      }
      const repoParts = (opts.repo as string).split("/");
      if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
        console.error(
          `Invalid --repo format "${opts.repo}". Expected owner/repo (e.g. my-org/my-repo)`,
        );
        process.exit(1);
      }
      const [ghOwner, ghRepo] = repoParts;
      credentials.token = opts.token;
      credentials.owner = ghOwner;
      credentials.repo = ghRepo;
      config.owner = ghOwner;
      config.repo = ghRepo;
      if (opts.openOnly) {
        config.openOnly = true;
      }
      if (opts.max) {
        // --max sets both per-type limits (e.g. --max 20 = at most 20 issues + 20 PRs)
        config.maxIssues = opts.max;
        config.maxPullRequests = opts.max;
      }
      if (opts.maxIssues) {
        config.maxIssues = opts.maxIssues;
      }
      if (opts.maxPrs) {
        config.maxPullRequests = opts.maxPrs;
      }
    } else if (crawlerType === "obsidian") {
      if (!opts.path) {
        console.error("Obsidian crawler requires --path <vault-path>");
        process.exit(1);
      }
      const { resolve } = await import("path");
      const vaultPath = resolve(opts.path);
      credentials.vaultPath = vaultPath;
      config.vaultPath = vaultPath;
    } else if (crawlerType === "mantisbt") {
      if (!opts.url) {
        console.error("MantisBT crawler requires --url <base-url>");
        process.exit(1);
      }
      config.baseUrl = opts.url;
      credentials.token = opts.token ?? "";
      credentials.baseUrl = opts.url;
      if (opts.projectId) {
        config.projectId = opts.projectId;
      }
      if (opts.max) {
        config.maxEntities = opts.max;
      }
    } else if (crawlerType === "git") {
      if (!opts.path) {
        console.error("Git crawler requires --path <repo-path>");
        process.exit(1);
      }
      const { resolve } = await import("path");
      const repoPath = resolve(opts.path);
      credentials.repoPath = repoPath;
      config.repoPath = repoPath;
      if (opts.includeDiffs) {
        config.includeDiffs = true;
      }
    }

    // Validate credentials
    const factory = registry.get(crawlerType)!;
    const crawler = factory();
    console.log("Validating credentials...");
    const valid = await crawler.validateCredentials(credentials);

    if (!valid) {
      console.error("Credential validation failed. Check your token and access.");
      process.exit(1);
    }

    // Create collection directory and database
    const home = getVeeContextHome();
    const collectionDir = join(home, "collections", opts.name);
    mkdirSync(collectionDir, { recursive: true });
    const collectionDbPath = getCollectionDbPath(opts.name);
    getCollectionDb(collectionDbPath);

    // Create markdown output directory
    mkdirSync(join(collectionDir, "markdown"), { recursive: true });

    // Save to context.yml
    addCollection(opts.name, {
      title: opts.title || undefined,
      crawler: crawlerType,
      config,
      credentials,
    });

    const displayName = opts.title ? `${opts.title} (${opts.name})` : opts.name;
    console.log(`Collection "${displayName}" created (${crawlerType})`);
    console.log(`  Database: ${collectionDbPath}`);
    console.log(`  Run "vctx sync ${opts.name}" to start syncing`);
  });
