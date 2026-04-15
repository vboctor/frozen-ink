import type { Env } from "../types";

export interface Entity {
  id: number;
  collection_name: string;
  external_id: string;
  entity_type: string;
  title: string;
  data: string;
  content_hash: string | null;
  markdown_path: string | null;
  markdown_mtime: number | null;
  markdown_size: number | null;
  url: string | null;
  tags: string | null;
  out_links: string | null;
  in_links: string | null;
  assets: string | null;
  created_at: string;
  updated_at: string;
}

export async function getEntityByMarkdownPath(
  db: D1Database,
  collectionName: string,
  markdownPath: string,
): Promise<Entity | null> {
  const result = await db
    .prepare("SELECT * FROM entities WHERE collection_name = ? AND markdown_path = ?")
    .bind(collectionName, markdownPath)
    .first<Entity>();
  return result ?? null;
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
  const rel = result.markdown_path;
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

export function parseEntityTags(entity: Entity): string[] {
  if (!entity.tags) return [];
  try { return JSON.parse(entity.tags); } catch { return []; }
}

export function parseOutLinks(entity: Entity): string[] {
  if (!entity.out_links) return [];
  try { return JSON.parse(entity.out_links); } catch { return []; }
}

export function parseInLinks(entity: Entity): string[] {
  if (!entity.in_links) return [];
  try { return JSON.parse(entity.in_links); } catch { return []; }
}

export function parseAssets(entity: Entity): Array<{ filename: string; mimeType: string; storagePath: string; hash: string }> {
  if (!entity.assets) return [];
  try { return JSON.parse(entity.assets); } catch { return []; }
}

export async function getBacklinks(
  db: D1Database,
  collectionName: string,
  targetExternalId: string,
): Promise<Array<{ entity: Entity }>> {
  const { results } = await db
    .prepare("SELECT * FROM entities WHERE collection_name = ?")
    .bind(collectionName)
    .all<Entity>();

  const out: Array<{ entity: Entity }> = [];
  for (const entity of results ?? []) {
    const outLinks = parseOutLinks(entity);
    if (outLinks.includes(targetExternalId)) {
      out.push({ entity });
    }
  }
  return out;
}

export async function getOutgoingLinks(
  db: D1Database,
  collectionName: string,
  sourceEntity: Entity,
): Promise<Array<{ entity: Entity | null; externalId: string }>> {
  const outLinks = parseOutLinks(sourceEntity);
  const out: Array<{ entity: Entity | null; externalId: string }> = [];

  for (const targetExtId of outLinks) {
    const entity = await getEntityByExternalId(db, collectionName, targetExtId);
    out.push({ entity, externalId: targetExtId });
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

export async function getEntitiesByExternalIds(
  db: D1Database,
  collectionName: string,
  externalIds: string[],
): Promise<Entity[]> {
  if (externalIds.length === 0) return [];
  const placeholders = externalIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM entities WHERE collection_name = ? AND external_id IN (${placeholders})`)
    .bind(collectionName, ...externalIds)
    .all<Entity>();
  return results ?? [];
}

export async function getFullManifest(
  db: D1Database,
  collectionName: string,
): Promise<Array<{ externalId: string; hash: string }>> {
  const { results } = await db
    .prepare("SELECT external_id, content_hash FROM entities WHERE collection_name = ?")
    .bind(collectionName)
    .all<{ external_id: string; content_hash: string | null }>();
  return (results ?? []).map((r) => ({
    externalId: r.external_id,
    hash: r.content_hash ?? "",
  }));
}
