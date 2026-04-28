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
  entityMarkdownPath,
  splitMarkdownPath,
  computeEntityHash,
} from "@frozenink/core";
import type { EntityData } from "@frozenink/core";
import { eq } from "drizzle-orm";
import { gitHubTheme, obsidianTheme, gitTheme, mantisHubTheme, rssTheme, evernoteTheme } from "@frozenink/crawlers";

/** Write <folder-name>.yml config files for folders matching the theme's folderConfigs(). */
async function writeFolderConfigFiles(
  themeEngine: ThemeEngine,
  crawlerType: string,
  storage: LocalStorageBackend,
  basePath: string,
): Promise<void> {
  const configs = themeEngine.getFolderConfigs(crawlerType);

  const allDirs = await storage.listDirs!(basePath);

  // Collect dirs that contain at least one markdown file (directly or via subdirs).
  const allFiles = await storage.list(basePath);
  const dirsWithMarkdown = new Set<string>();
  for (const filePath of allFiles) {
    if (!filePath.endsWith(".md")) continue;
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirsWithMarkdown.add(parts.slice(0, i).join("/"));
    }
  }

  for (const dirPath of allDirs) {
    const folderName = dirPath.split("/").pop()!;
    // Remove stale yml files from dirs that no longer contain any markdown files.
    if (!dirsWithMarkdown.has(dirPath)) {
      try {
        await storage.delete(`${dirPath}/${folderName}.yml`);
      } catch {
        // yml may not exist — fine
      }
      continue;
    }
    if (Object.keys(configs).length === 0 || !(folderName in configs)) continue;
    const config = configs[folderName];
    const lines: string[] = [];
    if (config.visible === false) lines.push("visible: false");
    if (config.sort === "DESC") lines.push("sort: DESC");
    if (lines.length === 0) continue;
    await storage.write(`${dirPath}/${folderName}.yml`, lines.join("\n") + "\n");
  }
}

export function createGenerateThemeEngine(): ThemeEngine {
  const themeEngine = new ThemeEngine();
  themeEngine.register(gitHubTheme);
  themeEngine.register(obsidianTheme);
  themeEngine.register(gitTheme);
  themeEngine.register(mantisHubTheme);
  themeEngine.register(rssTheme);
  themeEngine.register(evernoteTheme);
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
      .select({ folder: entities.folder, slug: entities.slug })
      .from(entities)
      .where(eq(entities.externalId, externalId))
      .all();
    const r = rows[0];
    if (!r || r.folder == null || r.slug == null) return undefined;
    return r.folder ? `${r.folder}/${r.slug}` : r.slug;
  };
  const entityTitleLookup = (externalId: string): string | undefined => {
    const rows = colDb
      .select({ title: entities.title })
      .from(entities)
      .where(eq(entities.externalId, externalId))
      .all();
    return rows[0]?.title ?? undefined;
  };

  // Build stem-matching wikilink resolver (for Obsidian [[bare name]] links)
  const allEntityRows = colDb
    .select({ externalId: entities.externalId, folder: entities.folder, slug: entities.slug })
    .from(entities)
    .all();
  const byExtId = new Map<string, string>();
  const byStem = new Map<string, string>();
  for (const r of allEntityRows) {
    if (r.folder == null || r.slug == null) continue;
    const noExt = r.folder ? `${r.folder}/${r.slug}` : r.slug;
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

  // Pre-build once for O(1) wikilink target lookup across all entities
  const allByMdPath = new Map<string, string>();
  for (const e of allEntities) {
    const mp = entityMarkdownPath(e.folder, e.slug);
    if (mp) allByMdPath.set(mp, e.externalId);
  }

  for (const entity of allEntities) {
    // Re-derive title from stored data (no API call needed).
    const entityData = (entity.data as EntityData) ?? { source: {} };
    const baseCtx = {
      entity: {
        externalId: entity.externalId,
        entityType: entity.entityType,
        title: entity.title,
        data: entityData.source as Record<string, unknown>,
        url: entityData.url ?? undefined,
        tags: entityData.tags ?? [],
      },
      collectionName: col.name,
      crawlerType: col.crawler,
      lookupEntityPath: entityPathLookup,
      lookupEntityTitle: entityTitleLookup,
      resolveWikilink,
    };
    const derivedTitle = themeEngine.getTitle(baseCtx);
    const title = derivedTitle ?? entity.title;

    const renderCtx = derivedTitle ? { ...baseCtx, entity: { ...baseCtx.entity, title } } : baseCtx;

    const newPath = themeEngine.getFilePath(renderCtx);
    const newStoragePath = `${markdownBasePath}/${newPath}`;
    const markdown = themeEngine.render(renderCtx);

    // Handle rename: delete old file if path changed
    const existingPath = entityMarkdownPath(entity.folder, entity.slug);
    if (existingPath && existingPath !== newPath) {
      try {
        await storage.delete(`${markdownBasePath}/${existingPath}`);
      } catch {
        // File may already be gone
      }
      renamed++;
    }

    // Read-before-write: preserve mtime when content is unchanged
    let needsWrite = true;
    try {
      const existing = await storage.read(newStoragePath);
      if (existing === markdown) needsWrite = false;
    } catch {
      // File doesn't exist yet
    }
    if (needsWrite) {
      await storage.write(newStoragePath, markdown);
    }

    const { folder: genFolder, slug: genSlug } = splitMarkdownPath(newPath);

    colDb
      .update(entities)
      .set({
        title,
        data: entityData,
        folder: genFolder,
        slug: genSlug,
      })
      .where(eq(entities.id, entity.id))
      .run();

    // Rebuild FTS index — preserve any previously-extracted attachment text.
    const attachmentText = (entityData.assets ?? [])
      .map((a) => a.text)
      .filter((t): t is string => Boolean(t && t.trim()))
      .join("\n");
    indexer.updateIndex({
      id: entity.id,
      externalId: entity.externalId,
      entityType: entity.entityType,
      title,
      content: markdown,
      tags: entityData.tags ?? [],
      attachmentText,
    });

    // Rebuild entity out_links in data
    const targets = extractWikilinks(markdown, newPath);
    const outLinkExternalIds: string[] = [];
    for (const target of targets) {
      const targetExtId = allByMdPath.get(`${target}.md`);
      if (targetExtId) {
        outLinkExternalIds.push(targetExtId);
      }
    }
    // Read current data and update out_links
    const [currentRow] = colDb.select({ data: entities.data }).from(entities).where(eq(entities.id, entity.id)).all();
    const currentData: EntityData = (currentRow?.data as EntityData) ?? { source: {} };
    colDb
      .update(entities)
      .set({ data: { ...currentData, out_links: outLinkExternalIds } })
      .where(eq(entities.id, entity.id))
      .run();

    generated++;
  }

  indexer.close();

  // Rebuild in_links from out_links
  const allEntitiesForInLinks = colDb.select().from(entities).all();
  const inLinksMap = new Map<string, string[]>();
  for (const e of allEntitiesForInLinks) {
    const eData = (e.data as EntityData) ?? { source: {} };
    const outLinks: string[] = eData.out_links ?? [];
    for (const targetExtId of outLinks) {
      const existing = inLinksMap.get(targetExtId) ?? [];
      existing.push(e.externalId);
      inLinksMap.set(targetExtId, existing);
    }
  }
  for (const e of allEntitiesForInLinks) {
    const newInLinks = inLinksMap.get(e.externalId) ?? [];
    const eData = (e.data as EntityData) ?? { source: {} };
    colDb
      .update(entities)
      .set({ data: { ...eData, in_links: newInLinks } })
      .where(eq(entities.id, e.id))
      .run();
  }

  // Recompute content_hash for every entity so that the stored hash stays
  // consistent with the regenerated title/folder/slug/links. Without this,
  // downstream publish/pull diff tooling sees phantom mismatches.
  const allEntitiesForHash = colDb.select().from(entities).all();
  for (const e of allEntitiesForHash) {
    const hash = computeEntityHash({
      entityType: e.entityType,
      title: e.title,
      folder: e.folder ?? null,
      slug: e.slug ?? null,
      data: e.data as EntityData,
    });
    if (hash !== e.contentHash) {
      colDb.update(entities).set({ contentHash: hash }).where(eq(entities.id, e.id)).run();
    }
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
  .addHelpText("after", `
Examples:
  fink generate my-vault
  fink generate "*"
`)
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
