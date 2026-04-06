import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getCollectionDb,
  contextExists,
  listCollections,
  getCollection,
  getCollectionDbPath,
  entities,
  entityTags,
  entityLinks,
  ThemeEngine,
  LocalStorageBackend,
  SearchIndexer,
  extractWikilinks,
} from "@veecontext/core";
import { eq } from "drizzle-orm";
import { createDefaultRegistry, gitHubTheme, obsidianTheme, gitTheme, mantisBTTheme } from "@veecontext/crawlers";

export const generateCommand = new Command("generate")
  .description(
    "Re-generate markdown files from existing entity data (re-renders without re-syncing; handles file renames)",
  )
  .argument("<collection>", 'Collection name or "*" for all collections')
  .action(async (collection: string) => {
    if (!contextExists()) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const home = getVeeContextHome();
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

    const themeEngine = new ThemeEngine();
    themeEngine.register(gitHubTheme);
    themeEngine.register(obsidianTheme);
    themeEngine.register(gitTheme);
    themeEngine.register(mantisBTTheme);

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

      const colDb = getCollectionDb(dbPath);
      const collectionDir = join(home, "collections", col.name);
      const storage = new LocalStorageBackend(collectionDir);
      const markdownBasePath = "markdown";

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

      const indexer = new SearchIndexer(dbPath);
      indexer.clearIndex();
      colDb.delete(entityLinks).run();

      const allEntities = colDb.select().from(entities).all();
      let generated = 0;
      let renamed = 0;

      for (const entity of allEntities) {
        const tags = colDb
          .select()
          .from(entityTags)
          .where(eq(entityTags.entityId, entity.id))
          .all()
          .map((t) => t.tag);

        const renderCtx = {
          entity: {
            externalId: entity.externalId,
            entityType: entity.entityType,
            title: entity.title,
            data: entity.data as Record<string, unknown>,
            url: entity.url ?? undefined,
            tags,
          },
          collectionName: col.name,
          crawlerType: col.crawler,
          lookupEntityPath: entityPathLookup,
        };

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

        // Update entity record with new path and mtime
        colDb
          .update(entities)
          .set({
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
          title: entity.title,
          content: markdown,
          tags,
        });

        // Rebuild entity links
        const targets = extractWikilinks(markdown);
        for (const target of targets) {
          colDb
            .insert(entityLinks)
            .values({
              sourceEntityId: entity.id,
              sourceMarkdownPath: newPath,
              targetPath: `${markdownBasePath}/${target}.md`,
            })
            .run();
        }

        generated++;
      }

      indexer.close();

      const renameNote = renamed > 0 ? `, ${renamed} renamed` : "";
      console.log(
        `  Generated ${generated} files from ${allEntities.length} entities${renameNote}`,
      );
    }
  });
