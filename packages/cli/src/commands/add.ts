import { Command } from "commander";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  getCollectionDb,
  collections,
} from "@veecontext/core";
import { createDefaultRegistry } from "@veecontext/crawlers";

export const addCommand = new Command("add")
  .description("Add a new collection")
  .argument("<crawler>", "Crawler type (e.g., github)")
  .requiredOption("--name <name>", "Collection name")
  .option("--token <token>", "Authentication token")
  .option("--owner <owner>", "Repository owner (for github)")
  .option("--repo <repo>", "Repository name (for github)")
  .option("--path <path>", "Path to local vault (for obsidian)")
  .action(async (crawlerType: string, opts: Record<string, string>) => {
    const home = getVeeContextHome();
    const masterDbPath = join(home, "master.db");

    if (!existsSync(masterDbPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
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
        crawlerType,
        config,
        credentials,
        dbPath: collectionDbPath,
      })
      .run();

    console.log(`Collection "${opts.name}" created (${crawlerType})`);
    console.log(`  Database: ${collectionDbPath}`);
    console.log(`  Run "vctx sync" to start syncing`);
  });
