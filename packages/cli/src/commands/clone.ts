import { Command } from "commander";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  addCollection,
  getCollection,
  getCollectionDbPath,
  entities,
  LocalStorageBackend,
  SearchIndexer,
  MetadataStore,
  splitMarkdownPath,
} from "@frozenink/core";
import type { EntityData } from "@frozenink/core";
import { eq } from "drizzle-orm";
import { RemoteClient } from "./remote-client";
import {
  computeSyncPlan,
  printSyncPlan,
  isSyncPlanEmpty,
  assertSafePath,
  type RemoteEntityData,
} from "./sync-plan";
import { createGenerateThemeEngine } from "./generate";

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

export const cloneCommand = new Command("clone")
  .description("Clone a published collection from a remote Frozen Ink site")
  .argument("<url>", "URL of the published site (e.g. https://my-fink.workers.dev)")
  .option("--name <name>", "Local collection name (defaults to remote collection name)")
  .option("--password <password>", "Password for protected sites")
  .option("--dry-run", "Show sync plan without making changes")
  .addHelpText("after", `
Examples:
  # Clone a published site
  fink clone https://my-fink.workers.dev --password secret123

  # Clone with a custom local name
  fink clone https://my-fink.workers.dev --name team-kb --password secret123

  # Preview what would be synced
  fink clone https://my-fink.workers.dev --password secret123 --dry-run
`)
  .action(async (url: string, opts: { name?: string; password?: string; dryRun?: boolean }) => {
    ensureInitialized();
    const home = getFrozenInkHome();

    const client = new RemoteClient(url, opts.password);

    console.log("Fetching manifest...");
    const { manifest, entries } = await client.getManifest();

    const remoteName = manifest.collection?.name ?? client.getCollectionName() ?? "remote";
    const localName = opts.name ?? remoteName;

    console.log(`Collection: ${manifest.collection?.title ?? remoteName} (${entries.length} entities)`);

    // Clone is like a pull from empty — all entities are "add"
    const plan = computeSyncPlan([], entries);

    if (opts.dryRun) {
      printSyncPlan(plan);
      return;
    }

    // Fail if collection already exists
    const existingCol = getCollection(localName);
    if (existingCol !== null) {
      console.error(`Collection "${localName}" already exists. Use 'fink pull' to update it.`);
      process.exit(1);
    }

    // Register the collection
    addCollection(localName, {
      crawler: "remote",
      title: manifest.collection?.title,
      config: { sourceUrl: url },
      credentials: opts.password ? { password: opts.password } : {},
    });

    const dbPath = getCollectionDbPath(localName);
    const colDb = getCollectionDb(dbPath);
    const collectionDir = join(home, "collections", localName);
    const storage = new LocalStorageBackend(collectionDir);

    // Persist the original crawler type so serve/prepare can use the right theme
    const meta = new MetadataStore(dbPath);
    meta.setCrawlerType(manifest.collection?.crawlerType ?? null);
    meta.close();

    // Batch-fetch all entity data
    const allExternalIds = entries.map((e) => e.externalId);
    console.log(`Fetching ${allExternalIds.length} entities...`);
    const remoteEntities = await client.getEntitiesBulk(allExternalIds);
    const remoteByExtId = new Map<string, RemoteEntityData>();
    for (const re of remoteEntities) {
      remoteByExtId.set(re.externalId, re);
    }

    // Insert entities into DB
    for (const re of remoteEntities) {
      const { folder, slug } = splitMarkdownPath(re.markdownPath);
      colDb
        .insert(entities)
        .values({
          externalId: re.externalId,
          entityType: re.entityType,
          title: re.title,
          data: re.data as unknown as EntityData,
          contentHash: re.hash,
          folder,
          slug,
        })
        .run();
    }

    // Generate markdown locally using the theme engine (same as generateCollection) so that
    // the on-disk files match what prepare/serve render — no re-generation needed on first serve.
    const crawlerType = manifest.collection?.crawlerType ?? "";
    const themeEngine = createGenerateThemeEngine();
    const indexer = new SearchIndexer(dbPath);

    if (themeEngine.has(crawlerType)) {
      // Build cross-entity lookup helpers (same pattern as generateCollection)
      const entityPathLookup = (externalId: string): string | undefined => {
        const [row] = colDb
          .select({ folder: entities.folder, slug: entities.slug })
          .from(entities)
          .where(eq(entities.externalId, externalId))
          .all();
        if (!row || row.folder == null || row.slug == null) return undefined;
        return row.folder ? `${row.folder}/${row.slug}` : row.slug;
      };

      const byExtId = new Map<string, string>();
      const byStem = new Map<string, string>();
      for (const re of remoteEntities) {
        if (!re.markdownPath) continue;
        const { folder, slug } = splitMarkdownPath(re.markdownPath);
        if (folder == null || slug == null) continue;
        const noExt = folder ? `${folder}/${slug}` : slug;
        byExtId.set(re.externalId, noExt);
        const stemName = slug.includes("/") ? slug.split("/").pop()! : slug;
        if (!byStem.has(stemName)) byStem.set(stemName, noExt);
      }
      const resolveWikilink = (target: string): string | undefined => {
        const clean = target.replace(/[#^].*$/, "").trim();
        if (!clean) return undefined;
        const withMd = clean.endsWith(".md") ? clean : `${clean}.md`;
        if (byExtId.has(withMd)) return byExtId.get(withMd);
        if (byExtId.has(clean)) return byExtId.get(clean);
        const stemName = clean.includes("/") ? clean.split("/").pop()! : clean;
        return byStem.get(stemName);
      };

      const mdEntities = remoteEntities.filter((e) => e.markdownPath);
      console.log(`Generating ${mdEntities.length} markdown files...`);
      let generated = 0;

      for (const re of mdEntities) {
        const entityData = re.data as unknown as EntityData;
        const ctx = {
          entity: {
            externalId: re.externalId,
            entityType: re.entityType,
            title: re.title,
            data: (entityData.source ?? {}) as Record<string, unknown>,
            url: entityData.url ?? undefined,
            tags: re.tags ?? [],
          },
          collectionName: localName,
          crawlerType,
          lookupEntityPath: entityPathLookup,
          resolveWikilink,
        };
        const derivedTitle = themeEngine.getTitle(ctx);
        const renderCtx = derivedTitle ? { ...ctx, entity: { ...ctx.entity, title: derivedTitle } } : ctx;
        const markdown = themeEngine.render(renderCtx);
        await storage.write(`content/${re.markdownPath!}`, markdown);

        // Index inline — content is already in memory, no storage read needed
        const [dbEntity] = colDb.select().from(entities).where(eq(entities.externalId, re.externalId)).all();
        if (dbEntity) {
          indexer.updateIndex({
            id: dbEntity.id,
            externalId: re.externalId,
            entityType: re.entityType,
            title: derivedTitle ?? re.title,
            content: markdown,
            tags: re.tags ?? [],
          });
        }

        generated++;
        if (process.stdout.isTTY) {
          process.stdout.write(`\r  ${generated}/${mdEntities.length} generated...`);
        } else if (generated % 50 === 0 || generated === mdEntities.length) {
          console.log(`  ${generated}/${mdEntities.length} generated...`);
        }
      }
      if (process.stdout.isTTY) process.stdout.write("\n");
    }

    indexer.close();

    // Download asset files
    const assetDownloads: Array<{ path: string; entity: RemoteEntityData }> = [];
    for (const re of remoteEntities) {
      for (const asset of (re.data as unknown as EntityData).assets ?? []) {
        assetDownloads.push({ path: asset.storagePath, entity: re });
      }
    }
    if (assetDownloads.length > 0) {
      console.log(`Downloading ${assetDownloads.length} assets...`);
      await runConcurrent(assetDownloads, 10, async ({ path }) => {
        assertSafePath(path);
        const content = await client.getFile(path);
        if (content) {
          await storage.write(`attachments/${path}`, Buffer.from(content));
        }
      });
    }

    console.log(`\nCloned "${localName}": ${remoteEntities.length} entities`);
  });
