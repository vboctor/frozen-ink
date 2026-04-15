import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  getFrozenInkHome,
  getCollectionDb,
  ensureInitialized,
  listCollections,
  getCollection,
  getCollectionDbPath,
  entities,
  SearchIndexer,
  extractWikilinks,
} from "@frozenink/core";
import { eq } from "drizzle-orm";

export const indexCommand = new Command("index")
  .description(
    "Re-index collections (rebuild search index and links from existing markdown)",
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
      console.log("No enabled collections to index");
      return;
    }

    for (const col of collectionRows) {
      console.log(`Indexing "${col.name}"...`);

      const dbPath = getCollectionDbPath(col.name);
      if (!existsSync(dbPath)) {
        console.error(`  Database not found at ${dbPath}, skipping`);
        continue;
      }

      const colDb = getCollectionDb(dbPath);
      const collectionDir = join(home, "collections", col.name);
      const markdownBasePath = "content";

      const indexer = new SearchIndexer(dbPath);
      indexer.clearIndex();

      const allEntities = colDb.select().from(entities).all();
      let indexed = 0;
      let linked = 0;

      for (const entity of allEntities) {
        if (!entity.markdownPath) continue;

        const filePath = join(collectionDir, "content", entity.markdownPath);
        if (!existsSync(filePath)) continue;

        const markdown = readFileSync(filePath, "utf-8");

        const entityTagNames: string[] = (entity as any).tags ?? [];

        indexer.updateIndex({
          id: entity.id,
          externalId: entity.externalId,
          entityType: entity.entityType,
          title: entity.title,
          content: markdown,
          tags: entityTagNames,
        });
        indexed++;

        // Rebuild outLinks
        const targets = extractWikilinks(markdown, entity.markdownPath ?? undefined);
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
            linked++;
          }
        }
        colDb
          .update(entities)
          .set({ outLinks: outLinkExternalIds })
          .where(eq(entities.id, entity.id))
          .run();
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

      console.log(
        `  Indexed ${indexed} entities, ${linked} links from ${allEntities.length} total entities`,
      );
    }
  });
