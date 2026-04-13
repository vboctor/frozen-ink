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
  entityTags,
  tags,
  links,
  ThemeEngine,
  LocalStorageBackend,
  SearchIndexer,
  extractWikilinks,
  CollectionEntry,
} from "@frozenink/core";
import { eq } from "drizzle-orm";
import { gitHubTheme, obsidianTheme, gitTheme, mantisHubTheme } from "@frozenink/crawlers";

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
    const base = `${markdownBasePath}/`;
    const relative = markdownPath.startsWith(base)
      ? markdownPath.slice(base.length)
      : markdownPath;
    return relative.endsWith(".md") ? relative.slice(0, -3) : relative;
  };

  // Build stem-matching wikilink resolver (for Obsidian [[bare name]] links)
  const allEntityRows = colDb
    .select({ externalId: entities.externalId, markdownPath: entities.markdownPath })
    .from(entities)
    .all();
  const byExtId = new Map<string, string>();
  const byStem = new Map<string, string>();
  const base = `${markdownBasePath}/`;
  for (const r of allEntityRows) {
    if (!r.markdownPath) continue;
    const rel = r.markdownPath.startsWith(base) ? r.markdownPath.slice(base.length) : r.markdownPath;
    const noExt = rel.endsWith(".md") ? rel.slice(0, -3) : rel;
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
  colDb.delete(links).run();

  const allEntities = colDb.select().from(entities).all();
  let generated = 0;
  let renamed = 0;

  for (const entity of allEntities) {
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

    const newPath = `${markdownBasePath}/${themeEngine.getFilePath(renderCtx)}`;
    const markdown = themeEngine.render(renderCtx);

    // Handle rename: delete old file if path changed
    if (entity.markdownPath && entity.markdownPath !== newPath) {
      try {
        await storage.delete(entity.markdownPath);
      } catch {
        // File may already be gone
      }
      renamed++;
    }

    // Write new markdown file
    await storage.write(newPath, markdown);
    const fileStat = await storage.stat(newPath);

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

    // Rebuild entity links
    const sourceFile = newPath.startsWith(markdownBasePath + "/")
      ? newPath.slice(markdownBasePath.length + 1)
      : undefined;
    const targets = extractWikilinks(markdown, sourceFile);
    for (const target of targets) {
      const targetPath = `${markdownBasePath}/${target}.md`;
      const [targetEntity] = colDb
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.markdownPath, targetPath))
        .all();
      if (targetEntity) {
        colDb
          .insert(links)
          .values({
            sourceEntityId: entity.id,
            targetEntityId: targetEntity.id,
          })
          .run();
      }
    }

    generated++;
  }

  indexer.close();

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
