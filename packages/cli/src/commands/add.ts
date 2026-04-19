import { Command } from "commander";
import { mkdirSync } from "fs";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  isValidCollectionKey,
  ensureInitialized,
  getCollection,
  addCollection,
  getCollectionDbPath,
  getNamedCredentials,
  resolveCredentials,
} from "@frozenink/core";
import { createDefaultRegistry, MantisHubCrawler } from "@frozenink/crawlers";

export const addCommand = new Command("add")
  .description("Add a new collection")
  .argument("<crawler>", "Crawler type (e.g., github)")
  .requiredOption("--name <key>", "Collection key (alphanumeric, dash, underscore)")
  .option("--title <title>", "Display title for the collection")
  .option("--description <text>", "Description of what this collection contains (helps AI know when to use it)")
  .option("--token <token>", "Authentication token")
  .option("--repo <repo>", "Repository in owner/repo format (for github)")
  .option("--path <path>", "Path to local directory (for obsidian, git)")
  .option("--include-diffs", "Include commit diffs (for git)")
  .option("--url <url>", "Base URL (for mantishub)")
  .option("--feed-url <url>", "RSS/Atom feed URL (for rss)")
  .option("--site-url <url>", "Site URL for RSS/Atom sitemap backfill (for rss)")
  .option("--project-name <name>", "Project name (for mantishub)")
  .option("--no-sitemap-backfill", "Disable sitemap backfill (for rss)")
  .option("--no-fetch-article-content", "Disable article HTML fetch fallback (for rss)")
  .option("--max <count>", "Maximum entities per type to sync (applies to issues and PRs independently)", parseInt)
  .option("--max-issues <count>", "Maximum issues to sync (for github)", parseInt)
  .option("--max-prs <count>", "Maximum pull requests to sync (for github)", parseInt)
  .option("--open-only", "Only sync open issues/PRs, delete closed ones (for github)")
  .option("--sync-entities <types>", "Comma-separated entity types to sync: issues,pages,users (for mantishub)")
  .option("--credentials <name>", "Use a named credential set from ~/.frozenink/credentials.yml")
  .addHelpText("after", `
Examples:
  # Add a GitHub repository
  fink add github --name my-repo --token ghp_xxx --repo owner/repo

  # Add a GitHub repo with limits (open issues only, max 500)
  fink add github --name my-repo --token ghp_xxx --repo owner/repo --open-only --max 500

  # Add a local Obsidian vault
  fink add obsidian --name my-notes --path ~/Documents/MyVault

  # Add a local Git repository
  fink add git --name my-code --path ~/projects/my-project

  # Add a Git repo with commit diffs included
  fink add git --name my-code --path ~/projects/my-project --include-diffs

  # Add a MantisHub project
  fink add mantishub --name bugs --url https://myproject.mantishub.io --token xxx --project-name MyProject

  # Add an RSS feed with sitemap backfill
  fink add rss --name blog --feed-url https://example.com/feed.xml --site-url https://example.com
`)
  .action(async (crawlerType: string, opts: Record<string, any>) => {
    ensureInitialized();

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
    let credentials: string | Record<string, unknown> = {};
    const config: Record<string, unknown> = {};

    // If --credentials is specified, use a named credential set from credentials.yml
    if (opts.credentials) {
      const credentialsPath = join(getFrozenInkHome(), "credentials.yml");
      const named = getNamedCredentials(opts.credentials);
      if (!named) {
        console.error(
          `Credential set "${opts.credentials}" not found.\nDefine it in ${credentialsPath} — see the file for format and examples.`,
        );
        process.exit(1);
      }
      credentials = opts.credentials; // store the reference name
    }

    // Build inline credentials only when not using a named reference
    const useNamedCreds = typeof credentials === "string";

    if (crawlerType === "github") {
      if (!useNamedCreds) {
        if (!opts.token || !opts.repo) {
          console.error(
            "GitHub crawler requires --token and --repo (in owner/repo format), or --credentials <name>",
          );
          process.exit(1);
        }
        (credentials as Record<string, unknown>).token = opts.token;
      } else if (!opts.repo) {
        console.error("GitHub crawler requires --repo (in owner/repo format)");
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
      config.owner = ghOwner;
      config.repo = ghRepo;
      if (opts.openOnly) {
        config.openOnly = true;
      }
      if (opts.max) {
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
      if (!useNamedCreds) {
        (credentials as Record<string, unknown>).vaultPath = vaultPath;
      }
      config.vaultPath = vaultPath;
    } else if (crawlerType === "mantishub") {
      if (!opts.url) {
        console.error("MantisHub crawler requires --url <base-url>");
        process.exit(1);
      }
      config.url = opts.url;
      if (!useNamedCreds) {
        (credentials as Record<string, unknown>).token = opts.token ?? "";
        (credentials as Record<string, unknown>).url = opts.url;
      }
      if (opts.projectName) {
        config.project = { name: opts.projectName };
      }
      if (opts.max) {
        config.maxEntities = opts.max;
      }
      if (opts.syncEntities) {
        const isMantisHub = opts.url.includes(".mantishub.");
        const valid = isMantisHub ? ["issues", "pages", "users"] : ["issues", "users"];
        const entityTypes = (opts.syncEntities as string).split(",").map((s: string) => s.trim()).filter(Boolean);
        const invalid = entityTypes.filter((e: string) => !valid.includes(e));
        if (invalid.length) {
          console.error(`Invalid entity type(s): ${invalid.join(", ")}. Valid: ${valid.join(", ")}`);
          process.exit(1);
        }
        config.entities = entityTypes;
      }
    } else if (crawlerType === "git") {
      if (!opts.path) {
        console.error("Git crawler requires --path <repo-path>");
        process.exit(1);
      }
      const { resolve } = await import("path");
      const repoPath = resolve(opts.path);
      if (!useNamedCreds) {
        (credentials as Record<string, unknown>).repoPath = repoPath;
      }
      config.repoPath = repoPath;
      if (opts.includeDiffs) {
        config.includeDiffs = true;
      }
    } else if (crawlerType === "rss") {
      if (!opts.feedUrl) {
        console.error("RSS crawler requires --feed-url <url>");
        process.exit(1);
      }
      config.feedUrl = opts.feedUrl;
      if (opts.siteUrl) config.siteUrl = opts.siteUrl;
      if (opts.max) config.maxItems = opts.max;
      config.sitemapBackfill = opts.sitemapBackfill !== false;
      config.fetchArticleContent = opts.fetchArticleContent !== false;
    }

    // Resolve credentials for validation (named ref → concrete object)
    const resolvedCreds = resolveCredentials(credentials);

    // Validate credentials
    const factory = registry.get(crawlerType)!;
    const crawler = factory();
    console.log("Validating credentials...");
    const valid = await crawler.validateCredentials(resolvedCreds);

    if (!valid) {
      console.error("Credential validation failed. Check your token and access.");
      process.exit(1);
    }

    // Resolve MantisHub project name → ID and persist both
    const project = config.project as { id?: number; name?: string } | undefined;
    if (crawlerType === "mantishub" && project?.name) {
      try {
        await crawler.initialize(config, resolvedCreds);
        const resolved = await (crawler as MantisHubCrawler).resolveProjectName(project.name);
        config.project = { id: resolved.id, name: resolved.name };
        console.log(`  Resolved project "${resolved.name}" → ID ${resolved.id}`);
      } catch (err) {
        console.error(`Failed to resolve project name: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    }

    // Create collection directory and database
    const home = getFrozenInkHome();
    const collectionDir = join(home, "collections", opts.name);
    mkdirSync(collectionDir, { recursive: true });
    const collectionDbPath = getCollectionDbPath(opts.name);
    getCollectionDb(collectionDbPath);

    // Create markdown output directory
    mkdirSync(join(collectionDir, "content"), { recursive: true });

    // For MantisHub with inline credentials, don't store url (it's already in config)
    if (crawlerType === "mantishub" && !useNamedCreds) {
      delete (credentials as Record<string, unknown>).url;
      delete (credentials as Record<string, unknown>).baseUrl;
    }

    // Save collection config
    addCollection(opts.name, {
      title: opts.title || undefined,
      description: opts.description || undefined,
      crawler: crawlerType,
      config,
      credentials,
    });

    const displayName = opts.title ? `${opts.title} (${opts.name})` : opts.name;
    console.log(`Collection "${displayName}" created (${crawlerType})`);
    console.log(`  Database: ${collectionDbPath}`);
    console.log(`  Run "fink sync ${opts.name}" to start syncing`);
  });
