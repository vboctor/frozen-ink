import { existsSync } from "fs";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  getCollectionDbPath,
  listCollections,
  updateCollection,
  ThemeEngine,
  LocalStorageBackend,
  CollectionEntry,
  entities,
  entityTags,
  tags,
} from "@frozenink/core";
import { eq, sql } from "drizzle-orm";
import { createDefaultRegistry } from "@frozenink/crawlers";
import { generateCollection, createGenerateThemeEngine } from "./generate";

type Log = (msg: string) => void;

type ColDb = ReturnType<typeof getCollectionDb>;

/** Build entity path lookup for theme cross-reference resolution. */
function makeEntityPathLookup(colDb: ColDb, basePath: string): (id: string) => string | undefined {
  return (externalId: string) => {
    const rows = colDb
      .select({ markdownPath: entities.markdownPath })
      .from(entities)
      .where(eq(entities.externalId, externalId))
      .all();
    const mdPath = rows[0]?.markdownPath;
    if (!mdPath) return undefined;
    const rel = mdPath.startsWith(`${basePath}/`) ? mdPath.slice(basePath.length + 1) : mdPath;
    return rel.endsWith(".md") ? rel.slice(0, -3) : rel;
  };
}

/** Build stem-matching wikilink resolver (for Obsidian-style [[bare name]] links). */
function makeResolveWikilink(colDb: ColDb, basePath: string): (target: string) => string | undefined {
  const allRows = colDb
    .select({ externalId: entities.externalId, markdownPath: entities.markdownPath })
    .from(entities)
    .all();

  const byExtId = new Map<string, string>();
  const byStem = new Map<string, string>();

  for (const row of allRows) {
    if (!row.markdownPath) continue;
    const rel = row.markdownPath.startsWith(`${basePath}/`)
      ? row.markdownPath.slice(basePath.length + 1)
      : row.markdownPath;
    const noExt = rel.endsWith(".md") ? rel.slice(0, -3) : rel;
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

/**
 * Write <folder-name>.yml config files for folders matching the theme's folderConfigs().
 * Only writes when the file is missing or its content has changed.
 * Returns true if any file was written.
 */
async function writeFolderConfigFiles(
  themeEngine: ThemeEngine,
  crawlerType: string,
  storage: LocalStorageBackend,
  basePath: string,
): Promise<boolean> {
  const configs = themeEngine.getFolderConfigs(crawlerType);
  if (Object.keys(configs).length === 0) return false;

  // Use listDirs so empty directories (e.g. assets/ with no files yet) are also covered
  const allDirs = await storage.listDirs!(basePath);
  let wrote = false;

  for (const dirPath of allDirs) {
    const folderName = dirPath.split("/").pop()!;
    if (!(folderName in configs)) continue;

    const config = configs[folderName];
    const lines: string[] = [];
    if (config.visible === false) lines.push("visible: false");
    if (config.sort === "DESC") lines.push("sort: DESC");
    const ymlContent = lines.join("\n") + "\n";
    const ymlPath = `${dirPath}/${folderName}.yml`;

    // Skip if already up to date
    try {
      const existing = await storage.read(ymlPath);
      if (existing === ymlContent) continue;
    } catch { /* file doesn't exist yet */ }

    await storage.write(ymlPath, ymlContent);
    wrote = true;
  }
  return wrote;
}

/**
 * Sample up to `sampleSize` entities per entity type and check two things:
 *   - Title freshness: does getTitle() match the stored DB title?
 *   - Markdown freshness: does render() match what's on disk?
 *
 * Returns counts of sampled entities and how many had title or markdown mismatches.
 */
async function checkSamples(
  colDb: ColDb,
  storage: LocalStorageBackend,
  themeEngine: ThemeEngine,
  crawlerType: string,
  collectionName: string,
  basePath: string,
  sampleSize: number,
): Promise<{ sampled: number; titleMismatches: number; markdownMismatches: number }> {
  // Get distinct entity types via GROUP BY
  const typeRows = colDb
    .select({ entityType: entities.entityType, count: sql<number>`count(*)` })
    .from(entities)
    .groupBy(entities.entityType)
    .all();

  const lookupEntityPath = makeEntityPathLookup(colDb, basePath);
  const resolveWikilink = makeResolveWikilink(colDb, basePath);

  let sampled = 0;
  let titleMismatches = 0;
  let markdownMismatches = 0;

  for (const { entityType } of typeRows) {
    const sample = colDb
      .select()
      .from(entities)
      .where(eq(entities.entityType, entityType))
      .limit(sampleSize)
      .all();

    for (const entity of sample) {
      if (!entity.markdownPath) continue;
      sampled++;

      // Load tags for accurate rendering
      const entityTagNames = colDb
        .select()
        .from(entityTags)
        .where(eq(entityTags.entityId, entity.id))
        .all()
        .map((t: any) => {
          const [tagRow] = colDb.select().from(tags).where(eq(tags.id, t.tagId)).all();
          return tagRow?.name ?? "";
        })
        .filter(Boolean);

      const ctx = {
        entity: {
          externalId: entity.externalId,
          entityType: entity.entityType,
          title: entity.title,
          data: entity.data as Record<string, unknown>,
          url: entity.url ?? undefined,
          tags: entityTagNames,
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
        onDisk = await storage.read(entity.markdownPath);
      } catch { /* file missing */ }

      // Re-render with the derived title (same logic as generateCollection)
      const renderCtx = derivedTitle ? { ...ctx, entity: { ...ctx.entity, title: derivedTitle } } : ctx;
      const rendered = themeEngine.render(renderCtx);
      if (onDisk !== rendered) markdownMismatches++;
    }
  }

  return { sampled, titleMismatches, markdownMismatches };
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

  // Step 1: Write folder yml files
  const ymlUpdated = await writeFolderConfigFiles(themeEngine, col.crawler, storage, basePath);
  if (ymlUpdated) log(`  Folder config files updated`);

  // Step 2: Sample check — skip if theme is not registered
  if (!themeEngine.has(col.crawler)) return;

  const { sampled, titleMismatches, markdownMismatches } = await checkSamples(
    colDb, storage, themeEngine, col.crawler, col.name, basePath, 10,
  );

  if (sampled === 0) return;

  const totalMismatches = titleMismatches + markdownMismatches;
  if (totalMismatches === 0) {
    log(`  Up to date (${sampled} sample${sampled === 1 ? "" : "s"} checked)`);
    return;
  }

  // Step 3: Mismatch — regenerate all entities
  const reasons = [
    titleMismatches > 0 ? `${titleMismatches} title${titleMismatches === 1 ? "" : "s"}` : "",
    markdownMismatches > 0 ? `${markdownMismatches} markdown` : "",
  ].filter(Boolean).join(", ");
  log(`  ${reasons} outdated (${totalMismatches}/${sampled} samples) — regenerating all...`);
  const summary = await generateCollection(col, home, themeEngine);
  if (summary) {
    log(`  ${summary}`);
    // Stamp the current crawler version so subsequent prepare runs skip the check
    const registry = createDefaultRegistry();
    const factory = registry.get(col.crawler);
    if (factory) {
      updateCollection(col.name, { version: factory().metadata.version ?? "1.0" });
    }
  }
}

/**
 * Run prepare for all enabled local collections.
 * Called before `serve` starts and before each `sync` run.
 * Safe to call multiple times — all steps are idempotent.
 */
export async function prepareCollections(
  home: string = getFrozenInkHome(),
  log: Log = console.log,
): Promise<void> {
  const themeEngine = createGenerateThemeEngine();
  const collections = listCollections().filter((c) => c.enabled);

  for (const col of collections) {
    if (!existsSync(getCollectionDbPath(col.name))) continue;
    log(`Preparing "${col.name}" (${col.crawler})...`);
    await prepareCollection(col, home, themeEngine, log);
  }
}
