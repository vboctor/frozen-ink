import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  listCollections,
  getCollection,
  getCollectionDbPath,
  entities,
  ThemeEngine,
  LocalStorageBackend,
  SearchIndexer,
  extractWikilinks,
  CollectionEntry,
} from "@frozenink/core";
import { eq } from "drizzle-orm";
import { gitHubTheme, obsidianTheme, gitTheme, mantisHubTheme } from "@frozenink/crawlers";

/** Write <folder-name>.yml config files for folders matching the theme's folderConfigs(). */
async function writeFolderConfigFiles(
  themeEngine: ThemeEngine,
  crawlerType: string,
  storage: LocalStorageBackend,
  basePath: string,
): Promise<void> {
  const configs = themeEngine.getFolderConfigs(crawlerType);
  if (Object.keys(configs).length === 0) return;

  // Use listDirs so empty directories (e.g. assets/ with no files yet) are also covered
  const allDirs = await storage.listDirs!(basePath);

  for (const dirPath of allDirs) {
    const folderName = dirPath.split("/").pop()!;
    if (!(folderName in configs)) continue;
    const config = configs[folderName];
    const lines: string[] = [];
    if (config.visible === false) lines.push("visible: false");
    if (config.sort === "DESC") lines.push("sort: DESC");
    await storage.write(`${dirPath}/${folderName}.yml`, lines.join("\n") + "\n");
  }
}

export function createGenerateThemeEngine(): ThemeEngine {
  const themeEngine = new ThemeEngine();
  themeEngine.register(gitHubTheme);
  themeEngine.register(obsidianTheme);
  themeEngine.register(gitTheme);
  themeEngine.register(mantisHubTheme);
  return themeEngine;
}

/**
 * Re-generate markdown files for a single collection from its stored entity data.
 * Returns a summary string (e.g. "Generated 42 files from 42 entities").
 */
export async function generateCollection(
  col: CollectionEntry & { name: string },
  home: string,
  themeEngine: ThemeEngine,
): Promise<string | null> {
  const dbPath = getCollectionDbPath(col.name);
  if (!existsSync(dbPath)) {
    return null;
  }

  if (!themeEngine.has(col.crawler)) {
    return null;
  }

  const colDb = getCollectionDb(dbPath);
  const collectionDir = join(home, "collections", col.name);
  const storage = new LocalStorageBackend(collectionDir);
  const markdownBasePath = "content";

  // Build a lookup function for cross-entity wikilinks (used by some themes)
  const entityPathLookup = (externalId: string): string | undefined => {
    const rows = colDb
      .select({ markdownPath: entities.markdownPath })
      .from(entities)
      .where(eq(entities.externalId, externalId))
      .all();
    const markdownPath = rows[0]?.markdownPath;
    if (!markdownPath) return undefined;
    return markdownPath.endsWith(".md") ? markdownPath.slice(0, -3) : markdownPath;
  };

  // Build stem-matching wikilink resolver (for Obsidian [[bare name]] links)
  const allEntityRows = colDb
    .select({ externalId: entities.externalId, markdownPath: entities.markdownPath })
    .from(entities)
    .all();
  const byExtId = new Map<string, string>();
  const byStem = new Map<string, string>();
  for (const r of allEntityRows) {
    if (!r.markdownPath) continue;
    const noExt = r.markdownPath.endsWith(".md") ? r.markdownPath.slice(0, -3) : r.markdownPath;
    byExtId.set(r.externalId, noExt);
    const stem = r.externalId.replace(/\.md$/, "");
    const stemName = stem.includes("/") ? stem.split("/").pop()! : stem;
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

  const indexer = new SearchIndexer(dbPath);
  indexer.clearIndex();

  const allEntities = colDb.select().from(entities).all();
  let generated = 0;
  let renamed = 0;

  for (const entity of allEntities) {
    const entityTagNames: string[] = (entity as any).tags ?? [];

    // Re-derive title from stored data (no API call needed).
    const baseCtx = {
      entity: {
        externalId: entity.externalId,
        entityType: entity.entityType,
        title: entity.title,
        data: entity.data as Record<string, unknown>,
        url: entity.url ?? undefined,
        tags: entityTagNames,
      },
      collectionName: col.name,
      crawlerType: col.crawler,
      lookupEntityPath: entityPathLookup,
      resolveWikilink,
    };
    const derivedTitle = themeEngine.getTitle(baseCtx);
    const title = derivedTitle ?? entity.title;

    const renderCtx = derivedTitle ? { ...baseCtx, entity: { ...baseCtx.entity, title } } : baseCtx;

    const newPath = themeEngine.getFilePath(renderCtx);
    const newStoragePath = `${markdownBasePath}/${newPath}`;
    const markdown = themeEngine.render(renderCtx);

    // Handle rename: delete old file if path changed
    if (entity.markdownPath && entity.markdownPath !== newPath) {
      try {
        await storage.delete(`${markdownBasePath}/${entity.markdownPath}`);
      } catch {
        // File may already be gone
      }
      renamed++;
    }

    // Write new markdown file
    await storage.write(newStoragePath, markdown);
    const fileStat = await storage.stat(newStoragePath);

    // Update entity record with new path, mtime, and re-derived title
    colDb
      .update(entities)
      .set({
        title,
        markdownPath: newPath,
        markdownMtime: fileStat?.mtimeMs ?? null,
        markdownSize: fileStat?.size ?? null,
      })
      .where(eq(entities.id, entity.id))
      .run();

    // Rebuild FTS index
    indexer.updateIndex({
      id: entity.id,
      externalId: entity.externalId,
      entityType: entity.entityType,
      title,
      content: markdown,
      tags: entityTagNames,
    });

    // Rebuild entity outLinks
    const targets = extractWikilinks(markdown, newPath);
    const outLinkExternalIds: string[] = [];
    for (const target of targets) {
      const targetPath = `${target}.md`;
      const [targetEntity] = colDb
        .select({ externalId: entities.externalId })
        .from(entities)
        .where(eq(entities.markdownPath, targetPath))
        .all();
      if (targetEntity) {
        outLinkExternalIds.push(targetEntity.externalId);
      }
    }
    colDb
      .update(entities)
      .set({ outLinks: outLinkExternalIds })
      .where(eq(entities.id, entity.id))
      .run();

    generated++;
  }

  indexer.close();

  // Rebuild inLinks from outLinks
  const allEntitiesForInLinks = colDb.select().from(entities).all();
  const inLinksMap = new Map<string, string[]>();
  for (const e of allEntitiesForInLinks) {
    const outLinks: string[] = (e.outLinks as string[] | null) ?? [];
    for (const targetExtId of outLinks) {
      const existing = inLinksMap.get(targetExtId) ?? [];
      existing.push(e.externalId);
      inLinksMap.set(targetExtId, existing);
    }
  }
  for (const e of allEntitiesForInLinks) {
    const newInLinks = inLinksMap.get(e.externalId) ?? [];
    colDb
      .update(entities)
      .set({ inLinks: newInLinks })
      .where(eq(entities.id, e.id))
      .run();
  }

  // Write folder config yml files (visible/sort settings)
  await writeFolderConfigFiles(themeEngine, col.crawler, storage, markdownBasePath);

  const renameNote = renamed > 0 ? `, ${renamed} renamed` : "";
  return `Generated ${generated} files from ${allEntities.length} entities${renameNote}`;
}

export const generateCommand = new Command("generate")
  .description(
    "Re-generate markdown files from existing entity data (re-renders without re-syncing; handles file renames)",
  )
  .argument("<collection>", 'Collection name or "*" for all collections')
  .action(async (collection: string) => {
    ensureInitialized();

    const home = getFrozenInkHome();
    let collectionRows = collection === "*"
      ? listCollections()
      : (() => {
          const col = getCollection(collection);
          if (!col) {
            console.error(`Collection "${collection}" not found`);
            process.exit(1);
          }
          return [col];
        })();

    collectionRows = collectionRows.filter((c) => c.enabled);

    if (collectionRows.length === 0) {
      console.log("No enabled collections to generate");
      return;
    }

    const themeEngine = createGenerateThemeEngine();

    for (const col of collectionRows) {
      console.log(`Generating "${col.name}" (${col.crawler})...`);

      const dbPath = getCollectionDbPath(col.name);
      if (!existsSync(dbPath)) {
        console.error(`  Database not found at ${dbPath}, skipping`);
        continue;
      }

      if (!themeEngine.has(col.crawler)) {
        console.error(`  No theme registered for type: ${col.crawler}, skipping`);
        continue;
      }

      const summary = await generateCollection(col, home, themeEngine);
      if (summary) {
        console.log(`  ${summary}`);
      }
    }
  });
