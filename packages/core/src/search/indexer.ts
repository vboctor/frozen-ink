import { openDatabase } from "../compat/sqlite";
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

export class SearchIndexer {
  private sqlite: any;
  /**
   * Whether the live FTS table includes the `attachment_text` column. New
   * collections always do; collections created before the column was added
   * keep their existing schema until they are explicitly reindexed (FTS5
   * doesn't support `ALTER TABLE ADD COLUMN`, and dropping the table
   * silently breaks search for every entity that hasn't changed since the
   * upgrade — so we leave it alone until a deliberate rebuild).
   */
  private hasAttachmentTextColumn = true;

  constructor(dbPath: string) {
    this.sqlite = openDatabase(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.createFtsTable();
  }

  private createFtsTable(): void {
    // Migrate the legacy schema that lacks `collection_name` — that
    // migration predates this work and is still required for correctness.
    try {
      const row = this.sqlite.prepare("PRAGMA table_info(entities_fts)").all();
      const cols = (row as any[]).map((r: any) => r.name);
      if (cols.length > 0 && !cols.includes("collection_name")) {
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
        tags,
        attachment_text
      );
    `);

    // Detect whether the (possibly pre-existing) FTS table actually has the
    // attachment_text column. Older collections won't, and that's fine —
    // attachment text is only meaningful for new (post-OCR) entities.
    try {
      const cols = (this.sqlite.prepare("PRAGMA table_info(entities_fts)").all() as any[]).map(
        (r: any) => r.name,
      );
      this.hasAttachmentTextColumn = cols.includes("attachment_text");
    } catch {
      this.hasAttachmentTextColumn = false;
    }
  }

  updateIndex(entity: {
    id: number;
    externalId: string;
    entityType: string;
    title: string;
    content: string;
    tags: string[];
    collectionName?: string;
    /** Concatenated OCR / extracted text from the entity's attachments. */
    attachmentText?: string;
  }): void {
    // Remove existing entry for this entity
    this.sqlite.exec(
      `DELETE FROM entities_fts WHERE entity_id = '${entity.id}'`,
    );

    if (this.hasAttachmentTextColumn) {
      this.sqlite
        .prepare(
          `INSERT INTO entities_fts (collection_name, entity_id, external_id, entity_type, title, content, tags, attachment_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entity.collectionName ?? "",
          String(entity.id),
          entity.externalId,
          entity.entityType,
          entity.title,
          entity.content,
          entity.tags.join(" "),
          entity.attachmentText ?? "",
        );
    } else {
      // Legacy schema (pre attachment_text). attachmentText is dropped on
      // the floor — it's only populated by the Evernote crawler today, and
      // pre-existing collections don't have any OCR text to preserve.
      this.sqlite
        .prepare(
          `INSERT INTO entities_fts (collection_name, entity_id, external_id, entity_type, title, content, tags) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entity.collectionName ?? "",
          String(entity.id),
          entity.externalId,
          entity.entityType,
          entity.title,
          entity.content,
          entity.tags.join(" "),
        );
    }
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
    //               title, content, tags, attachment_text.
    // Column weights: title 10, tags 5, body 1, attachment 0.25 (and 1.0
    // for the four UNINDEXED housekeeping columns, which never match). Tags
    // are deliberately weighted high — they're a curated signal that a note
    // is *about* a topic — so a tag match outranks a body match without
    // overpowering a title hit. Legacy collections without the
    // attachment_text column use the same weights minus the trailing one.
    const bm25Expr = this.hasAttachmentTextColumn
      ? "bm25(entities_fts, 1.0, 1.0, 1.0, 1.0, 10.0, 1.0, 5.0, 0.25)"
      : "bm25(entities_fts, 1.0, 1.0, 1.0, 1.0, 10.0, 1.0, 5.0)";
    let sql = `
      SELECT entity_id, external_id, entity_type, title,
        ${bm25Expr} AS rank,
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
