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
