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
  LocalStorageBackend,
  createCryptoHasher,
  openDatabase,
} from "@frozenink/core";
import { eq } from "drizzle-orm";

function tableExists(sqlite: any, tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName);
  return !!row;
}

async function upgradeCollection(name: string, home: string): Promise<string> {
  const dbPath = getCollectionDbPath(name);
  if (!existsSync(dbPath)) {
    return `Skipped "${name}" — no database`;
  }

  const sqlite = openDatabase(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");

  if (!tableExists(sqlite, "tags") || !tableExists(sqlite, "entity_tags")) {
    sqlite.close();
    return `Skipped "${name}" — already upgraded`;
  }

  // Open via Drizzle for new-schema writes
  const colDb = getCollectionDb(dbPath);
  const collectionDir = join(home, "collections", name);
  const storage = new LocalStorageBackend(collectionDir);

  const allEntities = colDb.select().from(entities).all();

  for (const entity of allEntities) {
    // Migrate tags
    let tagNames: string[] = [];
    if (tableExists(sqlite, "entity_tags") && tableExists(sqlite, "tags")) {
      const tagRows = sqlite
        .prepare(
          "SELECT t.name FROM entity_tags et INNER JOIN tags t ON et.tag_id = t.id WHERE et.entity_id = ?",
        )
        .all(entity.id) as Array<{ name: string }>;
      tagNames = tagRows.map((r) => r.name);
    }

    // Migrate outgoing links (resolve target entity IDs to externalIds)
    let outLinks: string[] = [];
    if (tableExists(sqlite, "links")) {
      const linkRows = sqlite
        .prepare("SELECT target_entity_id FROM links WHERE source_entity_id = ?")
        .all(entity.id) as Array<{ target_entity_id: number }>;
      for (const lr of linkRows) {
        const [target] = colDb
          .select({ externalId: entities.externalId })
          .from(entities)
          .where(eq(entities.id, lr.target_entity_id))
          .all();
        if (target) outLinks.push(target.externalId);
      }
    }

    // Migrate incoming links
    let inLinks: string[] = [];
    if (tableExists(sqlite, "links")) {
      const linkRows = sqlite
        .prepare("SELECT source_entity_id FROM links WHERE target_entity_id = ?")
        .all(entity.id) as Array<{ source_entity_id: number }>;
      for (const lr of linkRows) {
        const [source] = colDb
          .select({ externalId: entities.externalId })
          .from(entities)
          .where(eq(entities.id, lr.source_entity_id))
          .all();
        if (source) inLinks.push(source.externalId);
      }
    }

    // Migrate assets
    let assetEntries: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }> = [];
    if (tableExists(sqlite, "assets")) {
      const assetRows = sqlite
        .prepare("SELECT filename, mime_type, storage_path FROM assets WHERE entity_id = ?")
        .all(entity.id) as Array<{ filename: string; mime_type: string; storage_path: string }>;

      for (const att of assetRows) {
        let hash = "";
        const fullPath = join(collectionDir, att.storage_path);
        if (existsSync(fullPath)) {
          const content = readFileSync(fullPath);
          const hasher = createCryptoHasher("sha256");
          hasher.update(content);
          hash = hasher.digest("hex");
        }

        assetEntries.push({
          filename: att.filename,
          mimeType: att.mime_type,
          storagePath: att.storage_path,
          hash,
        });
      }
    }

    colDb
      .update(entities)
      .set({
        tags: tagNames,
        outLinks: outLinks,
        inLinks: inLinks,
        assets: assetEntries,
      })
      .where(eq(entities.id, entity.id))
      .run();
  }

  // Drop reference tables
  for (const table of ["entity_tags", "tags", "links", "assets"]) {
    if (tableExists(sqlite, table)) {
      sqlite.exec(`DROP TABLE ${table}`);
    }
  }

  // Rebuild FTS index
  const indexer = new SearchIndexer(dbPath);
  indexer.clearIndex();
  const upgradedEntities = colDb.select().from(entities).all();
  for (const entity of upgradedEntities) {
    if (!entity.markdownPath) continue;
    const filePath = join(collectionDir, "content", entity.markdownPath);
    let content = "";
    if (existsSync(filePath)) {
      content = readFileSync(filePath, "utf-8");
    }
    const updatedEntity = colDb
      .select()
      .from(entities)
      .where(eq(entities.id, entity.id))
      .all()[0];
    const tagNames: string[] = (updatedEntity as any)?.tags ?? [];
    indexer.updateIndex({
      id: entity.id,
      externalId: entity.externalId,
      entityType: entity.entityType,
      title: entity.title,
      content,
      tags: tagNames,
    });
  }
  indexer.close();

  return `Upgraded "${name}": ${allEntities.length} entities migrated`;
}

export const upgradeCommand = new Command("upgrade")
  .description("Upgrade collection schema (denormalize tags, links, assets into entity JSON)")
  .argument("[collection]", 'Collection name or omit for all collections')
  .action(async (collection?: string) => {
    ensureInitialized();
    const home = getFrozenInkHome();

    const collections = collection
      ? (() => {
          const col = getCollection(collection);
          if (!col) {
            console.error(`Collection "${collection}" not found`);
            process.exit(1);
          }
          return [col];
        })()
      : listCollections();

    for (const col of collections) {
      const result = await upgradeCollection(col.name, home);
      console.log(result);
    }
  });
