import { openDatabase } from "../compat/sqlite";
import { runSyncMigrations, LOCAL_MIGRATIONS } from "../db/migrations";
import { buildFtsQuery } from "./fts-query";

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

/**
 * FTS5 search over the `entities_fts` virtual table. Schema is owned by
 * `LOCAL_MIGRATIONS` (`packages/core/src/db/migrations/local.ts`); the
 * runner is invoked here defensively so callers that open this without
 * having gone through `getCollectionDb` first still see the latest shape.
 *
 * Final FTS column order (after migration v4):
 *   entity_id UNINDEXED, external_id UNINDEXED, entity_type UNINDEXED,
 *   title, content, tags, attachment_text
 *
 * bm25 weights — kept identical to `worker/src/db/search.ts`:
 *   title 10, tags 5, body 1, attachment 0.25 (UNINDEXED cols get 1.0
 *   but never match). See `SCHEMA.md` for the rationale on weights.
 */
export class SearchIndexer {
  private sqlite: any;

  constructor(dbPath: string) {
    this.sqlite = openDatabase(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    runSyncMigrations(this.sqlite, LOCAL_MIGRATIONS, dbPath);
  }

  updateIndex(entity: {
    id: number;
    externalId: string;
    entityType: string;
    title: string;
    content: string;
    tags: string[];
    /**
     * Accepted for API symmetry with older callers but no longer
     * persisted — the FTS table dropped its `collection_name` column in
     * migration v4 (it was never queried). Each collection has its own
     * SQLite file, so collection scoping is implicit.
     */
    collectionName?: string;
    /** Concatenated OCR / extracted text from the entity's attachments. */
    attachmentText?: string;
  }): void {
    this.sqlite.exec(
      `DELETE FROM entities_fts WHERE entity_id = '${entity.id}'`,
    );

    this.sqlite
      .prepare(
        `INSERT INTO entities_fts (entity_id, external_id, entity_type, title, content, tags, attachment_text) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        String(entity.id),
        entity.externalId,
        entity.entityType,
        entity.title,
        entity.content,
        entity.tags.join(" "),
        entity.attachmentText ?? "",
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

    // Column order: entity_id, external_id, entity_type (UNINDEXED), then
    // title=10, content=1, tags=5, attachment_text=0.25. Snippet uses
    // column 3 (title) — wait, snippet uses column 4 (content) in
    // 0-indexed terms. After v4 the indices are: 0=entity_id, 1=external_id,
    // 2=entity_type, 3=title, 4=content, 5=tags, 6=attachment_text. Snippet
    // continues to highlight column 4 (content) so the UI shows where in
    // the body the query matched.
    let sql = `
      SELECT entity_id, external_id, entity_type, title,
        bm25(entities_fts, 1.0, 1.0, 1.0, 10.0, 1.0, 5.0, 0.25) AS rank,
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
