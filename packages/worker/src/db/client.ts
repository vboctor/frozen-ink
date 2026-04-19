import type { Env } from "../types";

export interface Entity {
  id: number;
  external_id: string;
  entity_type: string;
  title: string;
  data: string;
  content_hash: string | null;
  folder: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityData {
  source?: Record<string, unknown>;
  out_links?: string[];
  in_links?: string[];
  assets?: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }>;
  url?: string | null;
  tags?: string[] | null;
}

/** Derive the markdown path from entity columns. */
export function entityMarkdownPath(entity: Pick<Entity, "folder" | "slug">): string | null {
  if (entity.folder == null || entity.slug == null) return null;
  return entity.folder ? `${entity.folder}/${entity.slug}.md` : `${entity.slug}.md`;
}

export function parseEntityData(entity: Entity): EntityData {
  if (!entity.data) return { source: {} };
  try { return JSON.parse(entity.data); } catch { return { source: {} }; }
}

export async function getEntityByFolderSlug(
  db: D1Database,
  folder: string,
  slug: string,
): Promise<Entity | null> {
  const result = await db
    .prepare("SELECT * FROM entities WHERE folder = ? AND slug = ?")
    .bind(folder, slug)
    .first<Entity>();
  return result ?? null;
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
  // D1's worker binding silently returns no rows when .all() is called on a
  // bare SELECT against a large table (observed: ~24K-row entities table
  // returns []). Page explicitly with LIMIT/OFFSET to dodge that limit.
  // ORDER BY id keeps pages stable across calls.
  const PAGE_SIZE = 5000;
  const out: Array<{ externalId: string; hash: string }> = [];
  let offset = 0;
  for (;;) {
    const { results } = await db
      .prepare("SELECT external_id, content_hash FROM entities ORDER BY id LIMIT ? OFFSET ?")
      .bind(PAGE_SIZE, offset)
      .all<{ external_id: string; content_hash: string | null }>();
    const rows = results ?? [];
    for (const r of rows) {
      out.push({ externalId: r.external_id, hash: r.content_hash ?? "" });
    }
    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }
  return out;
}
