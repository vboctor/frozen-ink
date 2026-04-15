import type { Env } from "../types";

export interface Entity {
  id: number;
  external_id: string;
  entity_type: string;
  title: string;
  data: string;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityData {
  source?: Record<string, unknown>;
  out_links?: string[];
  in_links?: string[];
  assets?: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }>;
  markdown_mtime?: number | null;
  markdown_size?: number | null;
  markdown_path?: string | null;
  url?: string | null;
  tags?: string[] | null;
}

export function parseEntityData(entity: Entity): EntityData {
  if (!entity.data) return { source: {} };
  try { return JSON.parse(entity.data); } catch { return { source: {} }; }
}

export async function getEntityByMarkdownPath(
  db: D1Database,
  markdownPath: string,
): Promise<Entity | null> {
  const result = await db
    .prepare("SELECT * FROM entities WHERE json_extract(data, '$.markdown_path') = ?")
    .bind(markdownPath)
    .first<Entity>();
  return result ?? null;
}

export async function getEntityMarkdownPathByExternalId(
  db: D1Database,
  externalId: string,
): Promise<string | null> {
  const result = await db
    .prepare("SELECT json_extract(data, '$.markdown_path') as markdown_path FROM entities WHERE external_id = ?")
    .bind(externalId)
    .first<{ markdown_path: string | null }>();
  if (!result?.markdown_path) return null;
  const rel = result.markdown_path;
  return rel.endsWith(".md") ? rel.slice(0, -3) : rel;
}

export async function getEntities(
  db: D1Database,
  opts: { limit?: number; offset?: number; entityType?: string },
): Promise<Entity[]> {
  let sql = "SELECT * FROM entities WHERE 1=1";
  const params: unknown[] = [];

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
  externalId: string,
): Promise<Entity | null> {
  const result = await db
    .prepare("SELECT * FROM entities WHERE external_id = ?")
    .bind(externalId)
    .first<Entity>();
  return result ?? null;
}

export async function getBacklinks(
  db: D1Database,
  targetEntity: Entity,
): Promise<Array<{ entity: Entity }>> {
  const data = parseEntityData(targetEntity);
  const inLinks = data.in_links ?? [];
  if (inLinks.length === 0) return [];
  const entities = await getEntitiesByExternalIds(db, inLinks);
  return entities.map((entity) => ({ entity }));
}

export async function getOutgoingLinks(
  db: D1Database,
  sourceEntity: Entity,
): Promise<Array<{ entity: Entity | null; externalId: string }>> {
  const data = parseEntityData(sourceEntity);
  const outLinks = data.out_links ?? [];
  if (outLinks.length === 0) return [];
  const entities = await getEntitiesByExternalIds(db, outLinks);
  const map = new Map(entities.map((e) => [e.external_id, e]));
  return outLinks.map((extId) => ({ entity: map.get(extId) ?? null, externalId: extId }));
}

export async function getEntityCount(
  db: D1Database,
): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM entities")
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function getEntitiesByExternalIds(
  db: D1Database,
  externalIds: string[],
): Promise<Entity[]> {
  if (externalIds.length === 0) return [];
  const placeholders = externalIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM entities WHERE external_id IN (${placeholders})`)
    .bind(...externalIds)
    .all<Entity>();
  return results ?? [];
}

export async function getFullManifest(
  db: D1Database,
): Promise<Array<{ externalId: string; hash: string }>> {
  const { results } = await db
    .prepare("SELECT external_id, content_hash FROM entities")
    .all<{ external_id: string; content_hash: string | null }>();
  return (results ?? []).map((r) => ({
    externalId: r.external_id,
    hash: r.content_hash ?? "",
  }));
}
