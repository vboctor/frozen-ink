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
  entityTags,
  tags,
  links,
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
      const markdownBasePath = "markdown";

      // Clear existing search index and links
      const indexer = new SearchIndexer(dbPath);
      indexer.clearIndex();
      colDb.delete(links).run();

      const allEntities = colDb.select().from(entities).all();
      let indexed = 0;
      let linked = 0;

      for (const entity of allEntities) {
        if (!entity.markdownPath) continue;

        const filePath = join(collectionDir, entity.markdownPath);
        if (!existsSync(filePath)) continue;

        const markdown = readFileSync(filePath, "utf-8");

        // Rebuild FTS index
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

        indexer.updateIndex({
          id: entity.id,
          externalId: entity.externalId,
          entityType: entity.entityType,
          title: entity.title,
          content: markdown,
          tags: entityTagNames,
        });
        indexed++;

        // Rebuild links
        const targets = extractWikilinks(markdown);
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
            linked++;
          }
        }
      }

      indexer.close();
      console.log(
        `  Indexed ${indexed} entities, ${linked} links from ${allEntities.length} total entities`,
      );
    }
  });
