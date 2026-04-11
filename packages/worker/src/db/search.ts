export interface SearchResult {
  entityId: number;
  externalId: string;
  entityType: string;
  title: string;
  collectionName: string;
  rank: number;
  snippet: string;
}

export async function searchEntities(
  db: D1Database,
  query: string,
  opts?: { collectionName?: string; entityType?: string; limit?: number },
): Promise<SearchResult[]> {
  const limit = opts?.limit ?? 20;

  // FTS5 query
  let sql = `
    SELECT
      entity_id, external_id, entity_type, title, collection_name,
      rank,
      snippet(entities_fts, 4, '<mark>', '</mark>', '…', 48) AS snippet
    FROM entities_fts
    WHERE entities_fts MATCH ?
  `;
  const params: unknown[] = [query];

  if (opts?.collectionName) {
    sql += " AND collection_name = ?";
    params.push(opts.collectionName);
  }

  if (opts?.entityType) {
    sql += " AND entity_type = ?";
    params.push(opts.entityType);
  }

  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);

  const { results } = await db.prepare(sql).bind(...params).all<{
    entity_id: number;
    external_id: string;
    entity_type: string;
    title: string;
    collection_name: string;
    rank: number;
    snippet: string;
  }>();

  return (results ?? []).map((r) => ({
    entityId: r.entity_id,
    externalId: r.external_id,
    entityType: r.entity_type,
    title: r.title,
    collectionName: r.collection_name,
    rank: r.rank,
    snippet: r.snippet ?? "",
  }));
}
