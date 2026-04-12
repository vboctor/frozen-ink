import type { Env } from "../types";

export interface CollectionMeta {
  name: string;
  title: string;
  crawler_type: string | null;
}

export interface Entity {
  id: number;
  collection_name: string;
  external_id: string;
  entity_type: string;
  title: string;
  data: string;
  markdown_path: string | null;
  url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface EntityTag {
  id: number;
  collection_name: string;
  entity_id: number;
  tag_id: number;
}

export interface Tag {
  id: number;
  name: string;
}

export interface EntityLink {
  id: number;
  collection_name: string;
  source_entity_id: number;
  target_entity_id: number;
}

export interface Asset {
  id: number;
  collection_name: string;
  entity_id: number;
  filename: string;
  mime_type: string;
  storage_path: string;
}

export async function getCollections(db: D1Database): Promise<CollectionMeta[]> {
  const { results } = await db.prepare("SELECT name, title, crawler_type FROM collections_meta").all<CollectionMeta>();
  return results ?? [];
}

export async function getCollection(db: D1Database, name: string): Promise<CollectionMeta | null> {
  const result = await db
    .prepare("SELECT name, title, crawler_type FROM collections_meta WHERE name = ?")
    .bind(name)
    .first<CollectionMeta>();
  return result ?? null;
}

export async function getEntityByMarkdownPath(
  db: D1Database,
  collectionName: string,
  markdownPath: string,
): Promise<Entity | null> {
  // Try with and without "markdown/" prefix
  const variants = [`markdown/${markdownPath}`, markdownPath];
  for (const variant of variants) {
    const result = await db
      .prepare("SELECT * FROM entities WHERE collection_name = ? AND markdown_path = ?")
      .bind(collectionName, variant)
      .first<Entity>();
    if (result) return result;
  }
  return null;
}

export async function getEntityMarkdownPathByExternalId(
  db: D1Database,
  collectionName: string,
  externalId: string,
): Promise<string | null> {
  const result = await db
    .prepare("SELECT markdown_path FROM entities WHERE collection_name = ? AND external_id = ?")
    .bind(collectionName, externalId)
    .first<{ markdown_path: string | null }>();
  if (!result?.markdown_path) return null;
  const prefix = "markdown/";
  const rel = result.markdown_path.startsWith(prefix)
    ? result.markdown_path.slice(prefix.length)
    : result.markdown_path;
  return rel.endsWith(".md") ? rel.slice(0, -3) : rel;
}

export async function getEntities(
  db: D1Database,
  collectionName: string,
  opts: { limit?: number; offset?: number; entityType?: string },
): Promise<Entity[]> {
  let sql = "SELECT * FROM entities WHERE collection_name = ?";
  const params: unknown[] = [collectionName];

  if (opts.entityType) {
    sql += " AND entity_type = ?";
    params.push(opts.entityType);
  }

  sql += " ORDER BY updated_at DESC";

  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  if (opts.offset) {
    sql += " OFFSET ?";
    params.push(opts.offset);
  }

  const { results } = await db.prepare(sql).bind(...params).all<Entity>();
  return results ?? [];
}

export async function getEntityByExternalId(
  db: D1Database,
  collectionName: string,
  externalId: string,
): Promise<Entity | null> {
  const result = await db
    .prepare("SELECT * FROM entities WHERE collection_name = ? AND external_id = ?")
    .bind(collectionName, externalId)
    .first<Entity>();
  return result ?? null;
}

export async function getEntityTags(
  db: D1Database,
  collectionName: string,
  entityId: number,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT t.name FROM entity_tags et INNER JOIN tags t ON et.tag_id = t.id WHERE et.collection_name = ? AND et.entity_id = ?",
    )
    .bind(collectionName, entityId)
    .all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

export async function getBacklinks(
  db: D1Database,
  collectionName: string,
  targetEntityId: number,
): Promise<Array<{ entity: Entity; link: EntityLink }>> {
  const { results: linkRows } = await db
    .prepare(
      "SELECT * FROM links WHERE collection_name = ? AND target_entity_id = ?",
    )
    .bind(collectionName, targetEntityId)
    .all<EntityLink>();

  const seen = new Set<number>();
  const out: Array<{ entity: Entity; link: EntityLink }> = [];

  for (const link of linkRows ?? []) {
    if (seen.has(link.source_entity_id)) continue;
    seen.add(link.source_entity_id);

    const entity = await db
      .prepare("SELECT * FROM entities WHERE id = ?")
      .bind(link.source_entity_id)
      .first<Entity>();
    if (entity) out.push({ entity, link });
  }

  return out;
}

export async function getOutgoingLinks(
  db: D1Database,
  collectionName: string,
  sourceEntityId: number,
): Promise<Array<{ entity: Entity | null; link: EntityLink }>> {
  const { results: linkRows } = await db
    .prepare(
      "SELECT * FROM links WHERE collection_name = ? AND source_entity_id = ?",
    )
    .bind(collectionName, sourceEntityId)
    .all<EntityLink>();

  const seen = new Set<number>();
  const out: Array<{ entity: Entity | null; link: EntityLink }> = [];

  for (const link of linkRows ?? []) {
    if (seen.has(link.target_entity_id)) continue;
    seen.add(link.target_entity_id);

    const entity = await db
      .prepare("SELECT * FROM entities WHERE id = ?")
      .bind(link.target_entity_id)
      .first<Entity>();

    out.push({ entity, link });
  }

  return out;
}

export async function getEntityCount(
  db: D1Database,
  collectionName: string,
): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM entities WHERE collection_name = ?")
    .bind(collectionName)
    .first<{ count: number }>();
  return result?.count ?? 0;
}
