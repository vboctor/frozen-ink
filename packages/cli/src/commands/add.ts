import { Command } from "commander";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  getCollectionDb,
  collections,
  isValidCollectionKey,
} from "@veecontext/core";
import { createDefaultRegistry } from "@veecontext/crawlers";

export const addCommand = new Command("add")
  .description("Add a new collection")
  .argument("<crawler>", "Crawler type (e.g., github)")
  .requiredOption("--name <key>", "Collection key (alphanumeric, dash, underscore)")
  .option("--title <title>", "Display title for the collection")
  .option("--token <token>", "Authentication token")
  .option("--owner <owner>", "Repository owner (for github)")
  .option("--repo <repo>", "Repository name (for github)")
  .option("--path <path>", "Path to local directory (for obsidian, git)")
  .option("--include-diffs", "Include commit diffs (for git)")
  .option("--url <url>", "Base URL (for mantisbt)")
  .option("--project-id <id>", "Project ID (for mantisbt)", parseInt)
  .option("--max <count>", "Maximum entities to sync (for mantisbt)", parseInt)
  .action(async (crawlerType: string, opts: Record<string, string>) => {
    const home = getVeeContextHome();
    const masterDbPath = join(home, "master.db");

    if (!existsSync(masterDbPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    if (!isValidCollectionKey(opts.name)) {
      console.error(
        `Invalid collection key "${opts.name}". Keys must contain only letters, numbers, dashes, and underscores.`,
      );
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
      if (!opts.token || !opts.owner || !opts.repo) {
        console.error(
          "GitHub crawler requires --token, --owner, and --repo",
        );
        process.exit(1);
      }
      credentials.token = opts.token;
      credentials.owner = opts.owner;
      credentials.repo = opts.repo;
      config.owner = opts.owner;
      config.repo = opts.repo;
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
    const collectionDir = join(home, "collections", opts.name);
    mkdirSync(collectionDir, { recursive: true });
    const collectionDbPath = join(collectionDir, "data.db");
    getCollectionDb(collectionDbPath);

    // Create markdown output directory
    mkdirSync(join(collectionDir, "markdown"), { recursive: true });

    // Insert into master DB
    const db = getMasterDb(masterDbPath);
    db.insert(collections)
      .values({
        name: opts.name,
        title: opts.title || null,
        crawlerType,
        config,
        credentials,
        dbPath: collectionDbPath,
      })
      .run();

    const displayName = opts.title ? `${opts.title} (${opts.name})` : opts.name;
    console.log(`Collection "${displayName}" created (${crawlerType})`);
    console.log(`  Database: ${collectionDbPath}`);
    console.log(`  Run "vctx sync ${opts.name}" to start syncing`);
  });
