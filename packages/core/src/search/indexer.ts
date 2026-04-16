import { openDatabase } from "../compat/sqlite";

/**
 * Build an FTS5 query from raw user input. Whitespace-separated "words" are
 * independent AND clauses; a word with internal punctuation (e.g. "8.4") is
 * expanded to an FTS5 phrase of its sub-tokens so they must appear adjacent
 * in the index — mirroring how FTS5's default unicode61 tokenizer actually
 * stored them at index time.
 *
 * Examples:
 *   "PHP 8.4"       → PHP* "8 4*"
 *   "fix lo"        → fix* lo*
 *   "mantis 1.2.3"  → mantis* "1 2 3*"
 *
 * Every final token gets a trailing `*` so partial typing still matches.
 * The phrase-with-last-prefix form `"a b c*"` is valid FTS5 syntax.
 */
export function buildFtsQuery(raw: string): string {
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

export interface SearchResult {
  entityId: number;
  externalId: string;
  entityType: string;
  title: string;
  rank: number;
  snippet: string;
}

export interface SearchFilters {
  entityType?: string;
  collectionName?: string;
  /**
   * Cap the number of rows returned. Pushed into the SQL as `LIMIT ?` so
   * FTS5 can use its internal top-K heap instead of materializing and
   * sorting every match — a big win on queries that hit thousands of rows
   * (e.g. a one- or two-character prefix against a large collection).
   */
  limit?: number;
}

export class SearchIndexer {
  private sqlite: any;

  constructor(dbPath: string) {
    this.sqlite = openDatabase(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.createFtsTable();
  }

  private createFtsTable(): void {
    // Migrate old FTS schema (without collection_name) by detecting column count
    try {
      const row = this.sqlite.prepare("PRAGMA table_info(entities_fts)").all();
      const hasCollectionName = (row as any[]).some((r: any) => r.name === "collection_name");
      if (!hasCollectionName && (row as any[]).length > 0) {
        this.sqlite.exec("DROP TABLE IF EXISTS entities_fts");
      }
    } catch {
      // Table may not exist yet
    }

    this.sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        collection_name UNINDEXED,
        entity_id UNINDEXED,
        external_id UNINDEXED,
        entity_type UNINDEXED,
        title,
        content,
        tags
      );
    `);
  }

  updateIndex(entity: {
    id: number;
    externalId: string;
    entityType: string;
    title: string;
    content: string;
    tags: string[];
    collectionName?: string;
  }): void {
    // Remove existing entry for this entity
    this.sqlite.exec(
      `DELETE FROM entities_fts WHERE entity_id = '${entity.id}'`,
    );

    const stmt = this.sqlite.prepare(
      `INSERT INTO entities_fts (collection_name, entity_id, external_id, entity_type, title, content, tags) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      entity.collectionName ?? "",
      String(entity.id),
      entity.externalId,
      entity.entityType,
      entity.title,
      entity.content,
      entity.tags.join(" "),
    );
  }

  /**
   * Refresh only the title/tags columns for an entity, leaving content intact.
   * Use this on the sync-engine's source-unchanged path — the crawler returned
   * the same payload but title or tags drifted (e.g. status rename), and the
   * rendered markdown didn't change so content is still correct.
   */
  refreshTitleAndTags(entityId: number, title: string, tags: string[]): void {
    const stmt = this.sqlite.prepare(
      `UPDATE entities_fts SET title = ?, tags = ? WHERE entity_id = ?`,
    );
    stmt.run(title, tags.join(" "), String(entityId));
  }

  removeIndex(entityId: number): void {
    this.sqlite.exec(
      `DELETE FROM entities_fts WHERE entity_id = '${entityId}'`,
    );
  }

  clearIndex(): void {
    this.sqlite.exec("DELETE FROM entities_fts");
  }

  search(query: string, filters?: SearchFilters): SearchResult[] {
    const ftsQuery = buildFtsQuery(query);

    if (!ftsQuery) return [];

    // Weight title matches much more heavily than body/tags so an entity
    // with the query in its title ranks above one that only mentions the
    // query in its content. bm25() weights are positional for every
    // declared column (UNINDEXED columns included), not just indexed ones.
    // Column order: collection_name, entity_id, external_id, entity_type,
    //               title, content, tags.
    // Lower bm25 score = better match.
    let sql = `
      SELECT entity_id, external_id, entity_type, title,
        bm25(entities_fts, 1.0, 1.0, 1.0, 1.0, 10.0, 1.0, 2.0) AS rank,
        snippet(entities_fts, 5, '<mark>', '</mark>', '…', 48) AS snippet
      FROM entities_fts
      WHERE entities_fts MATCH ?
    `;
    const params: (string | number | null)[] = [ftsQuery];

    if (filters?.entityType) {
      sql += ` AND entity_type = ?`;
      params.push(filters.entityType);
    }

    sql += ` ORDER BY rank`;
    if (filters?.limit != null && filters.limit > 0) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }

    const stmt = this.sqlite.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      entity_id: string;
      external_id: string;
      entity_type: string;
      title: string;
      rank: number;
      snippet: string;
    }>;

    return rows.map((row) => ({
      entityId: Number(row.entity_id),
      externalId: row.external_id,
      entityType: row.entity_type,
      title: row.title,
      rank: row.rank,
      snippet: row.snippet ?? "",
    }));
  }

  close(): void {
    this.sqlite.close();
  }
}
