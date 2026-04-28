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
  entityMarkdownPath,
} from "@frozenink/core";
import type { EntityData } from "@frozenink/core";
import { eq } from "drizzle-orm";

export const indexCommand = new Command("index")
  .description(
    "Re-index collections (rebuild search index and links from existing markdown)",
  )
  .argument("<collection>", 'Collection name or "*" for all collections')
  .addHelpText("after", `
Examples:
  fink index my-vault
  fink index "*"
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

      const byMdPath = new Map<string, string>();
      for (const e of allEntities) {
        const mp = entityMarkdownPath(e.folder, e.slug);
        if (mp) byMdPath.set(mp, e.externalId);
      }

      for (const entity of allEntities) {
        const entityData = entity.data as EntityData;
        const mdPath = entityMarkdownPath(entity.folder, entity.slug);
        if (!mdPath) continue;

        const filePath = join(collectionDir, "content", mdPath);
        if (!existsSync(filePath)) continue;

        const markdown = readFileSync(filePath, "utf-8");

        const attachmentText = (entityData.assets ?? [])
          .map((a) => a.text)
          .filter((t): t is string => Boolean(t && t.trim()))
          .join("\n");
        indexer.updateIndex({
          id: entity.id,
          externalId: entity.externalId,
          entityType: entity.entityType,
          title: entity.title,
          content: markdown,
          tags: entityData.tags ?? [],
          attachmentText,
        });
        indexed++;

        // Rebuild out_links in data
        const targets = extractWikilinks(markdown, mdPath);
        const outLinkExternalIds: string[] = [];
        for (const target of targets) {
          const targetExtId = byMdPath.get(`${target}.md`);
          if (targetExtId) {
            outLinkExternalIds.push(targetExtId);
            linked++;
          }
        }
        const [currentRow] = colDb.select({ data: entities.data }).from(entities).where(eq(entities.id, entity.id)).all();
        const currentData: EntityData = (currentRow?.data as EntityData) ?? { source: {} };
        colDb
          .update(entities)
          .set({ data: { ...currentData, out_links: outLinkExternalIds } })
          .where(eq(entities.id, entity.id))
          .run();
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

      console.log(
        `  Indexed ${indexed} entities, ${linked} links from ${allEntities.length} total entities`,
      );
    }
  });
