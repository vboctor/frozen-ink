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
  tag: string;
}

export interface EntityLink {
  id: number;
  collection_name: string;
  source_entity_id: number;
  source_markdown_path: string;
  target_path: string;
}

export interface Attachment {
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
    .prepare("SELECT tag FROM entity_tags WHERE collection_name = ? AND entity_id = ?")
    .bind(collectionName, entityId)
    .all<{ tag: string }>();
  return (results ?? []).map((r) => r.tag);
}

export async function getBacklinks(
  db: D1Database,
  collectionName: string,
  targetPath: string,
): Promise<Array<{ entity: Entity; link: EntityLink }>> {
  // Build variants for matching
  const variants = [targetPath, `markdown/${targetPath}`];
  if (!targetPath.endsWith(".md")) {
    variants.push(`${targetPath}.md`, `markdown/${targetPath}.md`);
  }
  const filename = targetPath.includes("/") ? targetPath.split("/").pop()! : null;
  if (filename) {
    variants.push(filename, `markdown/${filename}`);
    if (!filename.endsWith(".md")) {
      variants.push(`${filename}.md`, `markdown/${filename}.md`);
    }
  }

  const placeholders = variants.map(() => "?").join(",");
  const { results: linkRows } = await db
    .prepare(
      `SELECT * FROM entity_links WHERE collection_name = ? AND target_path IN (${placeholders})`,
    )
    .bind(collectionName, ...variants)
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
  sourcePath: string,
): Promise<Array<{ entity: Entity | null; targetPath: string }>> {
  const variants = [sourcePath, `markdown/${sourcePath}`];
  const placeholders = variants.map(() => "?").join(",");

  const { results: linkRows } = await db
    .prepare(
      `SELECT * FROM entity_links WHERE collection_name = ? AND source_markdown_path IN (${placeholders})`,
    )
    .bind(collectionName, ...variants)
    .all<EntityLink>();

  const seen = new Set<string>();
  const out: Array<{ entity: Entity | null; targetPath: string }> = [];

  for (const link of linkRows ?? []) {
    if (seen.has(link.target_path)) continue;
    seen.add(link.target_path);

    // Try direct match
    let entity = await db
      .prepare("SELECT * FROM entities WHERE markdown_path = ?")
      .bind(link.target_path)
      .first<Entity>();

    // Try filename match
    if (!entity) {
      const filename = link.target_path.split("/").pop();
      if (filename) {
        entity = await db
          .prepare("SELECT * FROM entities WHERE markdown_path LIKE ?")
          .bind(`%/${filename}`)
          .first<Entity>();
      }
    }

    out.push({ entity, targetPath: link.target_path });
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
