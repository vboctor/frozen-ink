import { openDatabase } from "../compat/sqlite";

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
}

export class SearchIndexer {
  private sqlite: any;

  constructor(dbPath: string) {
    this.sqlite = openDatabase(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.createFtsTable();
  }

  private createFtsTable(): void {
    this.sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
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
  }): void {
    // Remove existing entry for this entity
    this.sqlite.exec(
      `DELETE FROM entities_fts WHERE entity_id = '${entity.id}'`,
    );

    const stmt = this.sqlite.prepare(
      `INSERT INTO entities_fts (entity_id, external_id, entity_type, title, content, tags) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      String(entity.id),
      entity.externalId,
      entity.entityType,
      entity.title,
      entity.content,
      entity.tags.join(" "),
    );
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
    // Transform into FTS5 prefix query so partial words match.
    // e.g. "fix lo" → "fix* lo*" matches "fix-login-bug" title.
    // Strip FTS5 special characters to avoid syntax errors.
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        const safe = token.replace(/["()\^*.]/g, "");
        return safe ? `${safe}*` : null;
      })
      .filter(Boolean)
      .join(" ");

    if (!ftsQuery) return [];

    let sql = `
      SELECT entity_id, external_id, entity_type, title, rank,
        snippet(entities_fts, 4, '<mark>', '</mark>', '…', 48) AS snippet
      FROM entities_fts
      WHERE entities_fts MATCH ?
    `;
    const params: (string | number | null)[] = [ftsQuery];

    if (filters?.entityType) {
      sql += ` AND entity_type = ?`;
      params.push(filters.entityType);
    }

    sql += ` ORDER BY rank`;

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
