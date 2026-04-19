import { existsSync } from "fs";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  getCollectionDbPath,
  listCollections,
  ThemeEngine,
  LocalStorageBackend,
  MetadataStore,
  CollectionEntry,
  type FolderConfig,
  type EntityData,
  entities,
  entityMarkdownPath,
  computeEntityHash,
} from "@frozenink/core";
import { eq, sql } from "drizzle-orm";
import { createGenerateThemeEngine } from "./generate";

type Log = (msg: string) => void;

type ColDb = ReturnType<typeof getCollectionDb>;

/** Build entity path lookup for theme cross-reference resolution. */
function makeEntityPathLookup(colDb: ColDb): (id: string) => string | undefined {
  return (externalId: string) => {
    const rows = colDb
      .select({ folder: entities.folder, slug: entities.slug })
      .from(entities)
      .where(eq(entities.externalId, externalId))
      .all();
    const r = rows[0];
    if (!r || r.folder == null || r.slug == null) return undefined;
    return r.folder ? `${r.folder}/${r.slug}` : r.slug;
  };
}

/** Build stem-matching wikilink resolver (for Obsidian-style [[bare name]] links). */
function makeResolveWikilink(colDb: ColDb): (target: string) => string | undefined {
  const allRows = colDb
    .select({ externalId: entities.externalId, folder: entities.folder, slug: entities.slug })
    .from(entities)
    .all();

  const byExtId = new Map<string, string>();
  const byStem = new Map<string, string>();

  for (const row of allRows) {
    if (row.folder == null || row.slug == null) continue;
    const noExt = row.folder ? `${row.folder}/${row.slug}` : row.slug;
    byExtId.set(row.externalId, noExt);
    const stem = row.externalId.replace(/\.md$/, "");
    const stemName = stem.includes("/") ? stem.split("/").pop()! : stem;
    if (!byStem.has(stemName)) byStem.set(stemName, noExt);
  }

  return (target: string) => {
    const clean = target.replace(/[#^].*$/, "").trim();
    if (!clean) return undefined;
    const withMd = clean.endsWith(".md") ? clean : `${clean}.md`;
    if (byExtId.has(withMd)) return byExtId.get(withMd);
    if (byExtId.has(clean)) return byExtId.get(clean);
    const stemName = clean.includes("/") ? clean.split("/").pop()! : clean;
    return byStem.get(stemName);
  };
}

/** Serialize a FolderConfig to yml content (only non-default fields). */
function serializeFolderConfig(config: FolderConfig): string {
  const lines: string[] = [];
  if (config.visible === false) lines.push("visible: false");
  if (config.sort === "DESC") lines.push("sort: DESC");
  if (config.hide && config.hide.length > 0) {
    lines.push(`hide: [${config.hide.join(", ")}]`);
  }
  if (config.showCount === true) lines.push("showCount: true");
  return lines.join("\n") + "\n";
}

/**
 * Write <folder-name>.yml config files for folders matching the theme's folderConfigs().
 * Also writes root content.yml merging theme rootConfig with collection-level hide list.
 * Only writes when the file is missing or its content has changed.
 * Returns true if any file was written.
 */
async function writeFolderConfigFiles(
  themeEngine: ThemeEngine,
  crawlerType: string,
  storage: LocalStorageBackend,
  basePath: string,
  collectionHide: string[] = [],
): Promise<boolean> {
  const configs = themeEngine.getFolderConfigs(crawlerType);
  let wrote = false;

  if (Object.keys(configs).length > 0) {
    // Use listDirs so empty directories (e.g. assets/ with no files yet) are also covered
    const allDirs = await storage.listDirs!(basePath);

    for (const dirPath of allDirs) {
      const folderName = dirPath.split("/").pop()!;
      if (!(folderName in configs)) continue;

      const ymlContent = serializeFolderConfig(configs[folderName]);
      const ymlPath = `${dirPath}/${folderName}.yml`;

      // Skip if already up to date
      try {
        const existing = await storage.read(ymlPath);
        if (existing === ymlContent) continue;
      } catch { /* file doesn't exist yet */ }

      await storage.write(ymlPath, ymlContent);
      wrote = true;
    }
  }

  // Write root content.yml merging theme rootConfig with collection-level hide patterns
  const themeRootConfig = themeEngine.getRootConfig(crawlerType);
  const mergedHide = [
    ...(themeRootConfig.hide ?? []),
    ...collectionHide.filter((p) => !(themeRootConfig.hide ?? []).includes(p)),
  ];
  const rootConfig = { ...themeRootConfig, ...(mergedHide.length > 0 ? { hide: mergedHide } : {}) };
  const hasRootConfig = Object.keys(rootConfig).length > 0;
  if (hasRootConfig) {
    const rootYmlContent = serializeFolderConfig(rootConfig);
    const rootYmlPath = `${basePath}/content.yml`;
    try {
      const existing = await storage.read(rootYmlPath);
      if (existing !== rootYmlContent) {
        await storage.write(rootYmlPath, rootYmlContent);
        wrote = true;
      }
    } catch {
      await storage.write(rootYmlPath, rootYmlContent);
      wrote = true;
    }
  }

  return wrote;
}

/** Write AGENTS.md and CLAUDE.md to the collection root (outside content/). Only writes when content has changed. */
async function writeAgentFiles(
  themeEngine: ThemeEngine,
  col: CollectionEntry & { name: string },
  storage: LocalStorageBackend,
  log: Log,
): Promise<void> {
  const agentsContent = themeEngine.agentsMarkdown(col.crawler, {
    title: col.title ?? col.name,
    description: col.description,
    config: col.config as Record<string, unknown>,
  });

  if (agentsContent === null) return;

  const claudeContent =
    "See [AGENTS.md](AGENTS.md) for full project context, architecture, schemas, conventions, and navigation guide.\n";

  let changed = false;

  const agentsPath = "AGENTS.md";
  try {
    const existing = await storage.read(agentsPath);
    if (existing !== agentsContent) {
      await storage.write(agentsPath, agentsContent);
      changed = true;
    }
  } catch {
    await storage.write(agentsPath, agentsContent);
    changed = true;
  }

  const claudePath = "CLAUDE.md";
  try {
    const existing = await storage.read(claudePath);
    if (existing !== claudeContent) {
      await storage.write(claudePath, claudeContent);
      changed = true;
    }
  } catch {
    await storage.write(claudePath, claudeContent);
    changed = true;
  }

  if (changed) log(`  AGENTS.md and CLAUDE.md updated`);
}

/**
 * Sample up to `sampleSize` entities per entity type and check three things:
 *   - Title freshness: does getTitle() match the stored DB title?
 *   - Markdown freshness: does render() match what's on disk?
 *   - Hash freshness: does computeEntityHash() match the stored content_hash?
 *
 * Returns counts of sampled entities and how many had each kind of mismatch.
 */
async function checkSamples(
  colDb: ColDb,
  storage: LocalStorageBackend,
  themeEngine: ThemeEngine,
  crawlerType: string,
  collectionName: string,
  basePath: string,
  sampleSize: number,
): Promise<{
  sampled: number;
  titleMismatches: number;
  markdownMismatches: number;
  hashMismatches: number;
}> {
  // Get distinct entity types via GROUP BY
  const typeRows = colDb
    .select({ entityType: entities.entityType, count: sql<number>`count(*)` })
    .from(entities)
    .groupBy(entities.entityType)
    .all();

  const lookupEntityPath = makeEntityPathLookup(colDb);
  const resolveWikilink = makeResolveWikilink(colDb);

  let sampled = 0;
  let titleMismatches = 0;
  let markdownMismatches = 0;
  let hashMismatches = 0;

  for (const { entityType } of typeRows) {
    const sample = colDb
      .select()
      .from(entities)
      .where(eq(entities.entityType, entityType))
      .limit(sampleSize)
      .all();

    for (const entity of sample) {
      const entityData = entity.data as EntityData;
      const mdPath = entityMarkdownPath(entity.folder, entity.slug);
      if (!mdPath) continue;
      sampled++;

      const ctx = {
        entity: {
          externalId: entity.externalId,
          entityType: entity.entityType,
          title: entity.title,
          data: entityData.source as Record<string, unknown>,
          url: entityData.url ?? undefined,
          tags: entityData.tags ?? [],
        },
        collectionName,
        crawlerType,
        lookupEntityPath,
        resolveWikilink,
      };

      // Check title: compare DB title against what the theme derives from stored data
      const derivedTitle = themeEngine.getTitle(ctx);
      if (derivedTitle !== undefined && derivedTitle !== entity.title) {
        titleMismatches++;
      }

      // Check markdown: compare on-disk file against fresh render
      let onDisk: string | null = null;
      try {
        onDisk = await storage.read(`${basePath}/${mdPath}`);
      } catch { /* file missing */ }

      // Re-render with the derived title (same logic as generateCollection)
      const renderCtx = derivedTitle ? { ...ctx, entity: { ...ctx.entity, title: derivedTitle } } : ctx;
      const rendered = themeEngine.render(renderCtx);
      if (onDisk !== rendered) markdownMismatches++;

      // Check content hash: compare stored hash against one computed from the current row.
      // A mismatch means an earlier generate/edit updated the row without refreshing the
      // hash, which breaks publish/pull diff tooling.
      const expectedHash = computeEntityHash({
        entityType: entity.entityType,
        title: entity.title,
        folder: entity.folder ?? null,
        slug: entity.slug ?? null,
        data: entityData,
      });
      if (entity.contentHash !== expectedHash) hashMismatches++;
    }
  }

  return { sampled, titleMismatches, markdownMismatches, hashMismatches };
}

/**
 * Prepare a single collection before serve or sync:
 *   1. Apply DB schema migrations (automatic via getCollectionDb).
 *   2. Write missing/outdated folder yml config files.
 *   3. Sample up to 10 entities per type; if any mismatch → regenerate all.
 *
 * Skips silently if the collection has never been synced (no DB yet).
 */
export async function prepareCollection(
  col: CollectionEntry & { name: string },
  home: string,
  themeEngine: ThemeEngine,
  log: Log,
): Promise<void> {
  const dbPath = getCollectionDbPath(col.name);
  if (!existsSync(dbPath)) return; // Never synced — nothing to prepare

  // Opening the DB applies schema migrations automatically (ALTER TABLE IF NOT EXISTS)
  const colDb = getCollectionDb(dbPath);
  const collectionDir = join(home, "collections", col.name);
  const storage = new LocalStorageBackend(collectionDir);
  const basePath = "content";

  // For cloned ("remote") collections, resolve the original crawler type stored
  // in the DB metadata so that theme rendering and folder configs work correctly.
  let crawlerType = col.crawler;
  if (col.crawler === "remote") {
    const meta = new MetadataStore(dbPath);
    crawlerType = meta.getCrawlerType() ?? col.crawler;
    meta.close();
  }

  // Step 1: Write folder yml files and root content.yml (incorporating collection-level hide)
  const collectionHide = col.hide ?? [];
  const ymlUpdated = await writeFolderConfigFiles(themeEngine, crawlerType, storage, basePath, collectionHide);
  if (ymlUpdated) log(`  Folder config files updated`);

  // Step 1b: Always write AGENTS.md and CLAUDE.md (at collection root, outside content/)
  await writeAgentFiles(themeEngine, col, storage, log);

  // Step 2: Sample check — skip if theme is not registered
  if (!themeEngine.has(crawlerType)) return;

  const { sampled, titleMismatches, markdownMismatches, hashMismatches } = await checkSamples(
    colDb, storage, themeEngine, crawlerType, col.name, basePath, 10,
  );

  if (sampled === 0) return;

  const totalMismatches = titleMismatches + markdownMismatches + hashMismatches;
  if (totalMismatches === 0) {
    return;
  }

  // Step 3: Mismatch — warn the user and suggest running generate
  const reasons = [
    titleMismatches > 0 ? `${titleMismatches} title${titleMismatches === 1 ? "" : "s"}` : "",
    markdownMismatches > 0 ? `${markdownMismatches} markdown` : "",
    hashMismatches > 0 ? `${hashMismatches} hash${hashMismatches === 1 ? "" : "es"}` : "",
  ].filter(Boolean).join(", ");
  log(`  Warning: ${reasons} outdated (${totalMismatches}/${sampled} samples). Run: fink generate ${JSON.stringify(col.name)}`);
}

/**
 * Run prepare for all enabled local collections.
 * Called before `serve` starts and before each `sync` run.
 * Safe to call multiple times — all steps are idempotent.
 */
export async function prepareCollections(
  home: string = getFrozenInkHome(),
  log: Log = console.log,
  collectionName?: string,
): Promise<void> {
  const themeEngine = createGenerateThemeEngine();
  const collections = collectionName
    ? listCollections().filter((c) => c.name === collectionName)
    : listCollections().filter((c) => c.enabled);

  for (const col of collections) {
    if (!existsSync(getCollectionDbPath(col.name))) continue;
    log(`Preparing "${col.name}" (${col.crawler})...`);
    await prepareCollection(col, home, themeEngine, log);
  }
}
