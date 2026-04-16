export interface SearchResult {
  entityId: number;
  externalId: string;
  entityType: string;
  title: string;
  rank: number;
  snippet: string;
}

/**
 * Build an FTS5 query from raw user input. Whitespace-separated "words" are
 * independent AND clauses; a word with internal punctuation (e.g. "8.4") is
 * expanded to an FTS5 phrase of its sub-tokens so they must appear adjacent
 * in the index — mirroring how FTS5's default unicode61 tokenizer actually
 * stored them at index time.
 *
 *   "PHP 8.4"       → PHP* "8 4*"
 *   "fix lo"        → fix* lo*
 *   "mantis 1.2.3"  → mantis* "1 2 3*"
 */
function buildFtsQuery(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const clauses: string[] = [];
  for (const word of words) {
    const sub = word.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (sub.length === 0) continue;
    if (sub.length === 1) {
      clauses.push(`${sub[0]}*`);
    } else {
      const head = sub.slice(0, -1).join(" ");
      const tail = sub[sub.length - 1];
      clauses.push(`"${head} ${tail}*"`);
    }
  }
  return clauses.join(" ");
}

export async function searchEntities(
  db: D1Database,
  query: string,
  opts?: { entityType?: string; limit?: number },
): Promise<SearchResult[]> {
  const limit = opts?.limit ?? 20;

  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  // FTS5 query — weight title column higher than content/tags so title
  // matches rank ahead of body mentions. bm25() weights are positional for
  // every declared column including UNINDEXED ones. Published worker schema:
  //   entity_id, external_id, entity_type, title, content, tags.
  // Lower bm25 = better match.
  let sql = `
    SELECT
      entity_id, external_id, entity_type, title,
      bm25(entities_fts, 1.0, 1.0, 1.0, 10.0, 1.0, 2.0) AS rank,
      snippet(entities_fts, 3, '<mark>', '</mark>', '…', 48) AS snippet
    FROM entities_fts
    WHERE entities_fts MATCH ?
  `;
  const params: unknown[] = [ftsQuery];

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
    rank: number;
    snippet: string;
  }>();

  return (results ?? []).map((r) => ({
    entityId: r.entity_id,
    externalId: r.external_id,
    entityType: r.entity_type,
    title: r.title,
    rank: r.rank,
    snippet: r.snippet ?? "",
  }));
}
