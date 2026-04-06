import { eq, and } from "drizzle-orm";
import { getCollectionDb } from "../db/client";
import {
  entities,
  entityTags,
  attachments,
  syncState,
  syncRuns,
  entityRelations,
  entityLinks,
} from "../db/collection-schema";
import { SearchIndexer } from "../search/indexer";
import type { Crawler, CrawlerEntityData, SyncCursor } from "./interface";
import type { ThemeEngine } from "../theme/engine";
import type { StorageBackend } from "../storage/interface";

/** Returns true if any path segment starts with "." (hidden dirs like .git, .obsidian). */
function isToolPath(filePath: string): boolean {
  return filePath.split("/").some((segment) => segment.startsWith("."));
}

/** Returns true when the stored mtime+size match the current file stat. */
function statMatches(
  stored: { markdownMtime: number | null; markdownSize: number | null },
  current: { mtimeMs: number; size: number } | null,
): boolean {
  if (!current) return false;
  return stored.markdownMtime === current.mtimeMs && stored.markdownSize === current.size;
}

/** Extract wikilink targets from rendered markdown. Returns unique target strings. */
export function extractWikilinks(markdown: string): string[] {
  const targets = new Set<string>();
  // Negative lookbehind excludes ![[embeds]] (images / transclusions).
  // Capture group strips [[target#section]] and [[target^blockref]] anchors.
  const regex = /(?<!!)\[\[([^\]|]+?)(?:[#^][^\]|]*)?(?:\|[^\]]+?)?\]\]/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const target = match[1].trim();
    if (target) targets.add(target);
  }
  return Array.from(targets);
}

function computeHash(data: Record<string, unknown>): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(data));
  return hasher.digest("hex");
}

export interface SyncEngineOptions {
  crawler: Crawler;
  dbPath: string;
  collectionName: string;
  themeEngine: ThemeEngine;
  storage: StorageBackend;
  markdownBasePath: string;
  onEntityProcessed?: (info: {
    collectionName: string;
    externalId: string;
    created: boolean;
    updated: boolean;
  }) => void;
  onBatchFetched?: (info: {
    collectionName: string;
    externalIds: string[];
  }) => void;
}

export class SyncEngine {
  private crawler: Crawler;
  private db: ReturnType<typeof getCollectionDb>;
  private collectionName: string;
  private themeEngine: ThemeEngine;
  private storage: StorageBackend;
  private markdownBasePath: string;
  private searchIndexer: SearchIndexer;
  private onEntityProcessed?: SyncEngineOptions["onEntityProcessed"];
  private onBatchFetched?: SyncEngineOptions["onBatchFetched"];

  constructor(options: SyncEngineOptions) {
    this.crawler = options.crawler;
    this.db = getCollectionDb(options.dbPath);
    this.collectionName = options.collectionName;
    this.themeEngine = options.themeEngine;
    this.storage = options.storage;
    this.markdownBasePath = options.markdownBasePath;
    this.searchIndexer = new SearchIndexer(options.dbPath);
    this.onEntityProcessed = options.onEntityProcessed;
    this.onBatchFetched = options.onBatchFetched;
  }

  async run(): Promise<{ created: number; updated: number; deleted: number }> {
    const crawlerType = this.crawler.metadata.type;
    const startedAt = new Date().toISOString().replace("T", " ").replace("Z", "");

    // Create sync_run record
    this.db
      .insert(syncRuns)
      .values({ status: "running", startedAt })
      .run();
    const [runRecord] = this.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.startedAt, startedAt))
      .all();
    const runId = runRecord.id;

    let created = 0;
    let updated = 0;
    let deleted = 0;
    const errors: unknown[] = [];

    try {
      // Load existing cursor
      const [stateRow] = this.db
        .select()
        .from(syncState)
        .where(eq(syncState.crawlerType, crawlerType))
        .all();
      let cursor: SyncCursor | null = (stateRow?.cursor as SyncCursor) ?? null;

      // Sync loop
      let hasMore = true;
      while (hasMore) {
        const result = await this.crawler.sync(cursor);
        this.onBatchFetched?.({
          collectionName: this.collectionName,
          externalIds: result.entities.map((e) => e.externalId),
        });

        // Process entities
        for (const entityData of result.entities) {
          const counts = await this.upsertEntity(entityData, crawlerType);
          created += counts.created;
          updated += counts.updated;
          this.onEntityProcessed?.({
            collectionName: this.collectionName,
            externalId: entityData.externalId,
            created: counts.created > 0,
            updated: counts.updated > 0,
          });
        }

        // Handle deletions
        for (const externalId of result.deletedExternalIds) {
          const didDelete = await this.deleteEntity(externalId);
          if (didDelete) deleted++;
        }

        // Update cursor
        if (result.nextCursor) {
          cursor = result.nextCursor;
        }

        hasMore = result.hasMore;
      }

      // Persist cursor
      if (cursor) {
        if (stateRow) {
          this.db
            .update(syncState)
            .set({ cursor: cursor as Record<string, unknown>, updatedAt: new Date().toISOString().replace("T", " ").replace("Z", "") })
            .where(eq(syncState.id, stateRow.id))
            .run();
        } else {
          this.db
            .insert(syncState)
            .values({ crawlerType, cursor: cursor as Record<string, unknown> })
            .run();
        }
      }

      // Reconcile filesystem with DB
      await this.reconcile(crawlerType);

      // Update sync_run as completed
      this.db
        .update(syncRuns)
        .set({
          status: "completed",
          entitiesCreated: created,
          entitiesUpdated: updated,
          entitiesDeleted: deleted,
          errors: errors.length > 0 ? errors : null,
          completedAt: new Date().toISOString().replace("T", " ").replace("Z", ""),
        })
        .where(eq(syncRuns.id, runId))
        .run();

      return { created, updated, deleted };
    } catch (err) {
      errors.push(String(err));
      this.db
        .update(syncRuns)
        .set({
          status: "failed",
          entitiesCreated: created,
          entitiesUpdated: updated,
          entitiesDeleted: deleted,
          errors,
          completedAt: new Date().toISOString().replace("T", " ").replace("Z", ""),
        })
        .where(eq(syncRuns.id, runId))
        .run();
      throw err;
    }
  }

  private async upsertEntity(
    entityData: CrawlerEntityData,
    crawlerType: string,
  ): Promise<{ created: number; updated: number }> {
    const contentHash = entityData.contentHash ?? computeHash(entityData.data);

    // Check if entity already exists
    const [existing] = this.db
      .select()
      .from(entities)
      .where(eq(entities.externalId, entityData.externalId))
      .all();

    if (existing) {
      // Compare hash — skip re-render if unchanged
      if (existing.contentHash === contentHash) {
        return { created: 0, updated: 0 };
      }

      // Render markdown
      const markdown = this.renderMarkdown(entityData, crawlerType);
      const filePath = this.getMarkdownPath(entityData, crawlerType);
      await this.storage.write(filePath, markdown);
      const writtenStat = await this.storage.stat(filePath);

      // Update entity
      this.db
        .update(entities)
        .set({
          title: entityData.title,
          entityType: entityData.entityType,
          data: entityData.data,
          contentHash,
          markdownPath: filePath,
          markdownMtime: writtenStat?.mtimeMs ?? null,
          markdownSize: writtenStat?.size ?? null,
          url: entityData.url ?? null,
          updatedAt: new Date().toISOString().replace("T", " ").replace("Z", ""),
        })
        .where(eq(entities.id, existing.id))
        .run();

      // Update tags
      this.db.delete(entityTags).where(eq(entityTags.entityId, existing.id)).run();
      if (entityData.tags?.length) {
        for (const tag of entityData.tags) {
          this.db.insert(entityTags).values({ entityId: existing.id, tag }).run();
        }
      }

      // Handle attachments
      await this.syncAttachments(existing.id, entityData);

      // Extract and store outgoing links
      this.syncLinks(existing.id, filePath, markdown);

      // Update search index
      this.searchIndexer.updateIndex({
        id: existing.id,
        externalId: entityData.externalId,
        entityType: entityData.entityType,
        title: entityData.title,
        content: markdown,
        tags: entityData.tags ?? [],
      });

      return { created: 0, updated: 1 };
    }

    // New entity — render markdown
    const markdown = this.renderMarkdown(entityData, crawlerType);
    const filePath = this.getMarkdownPath(entityData, crawlerType);
    await this.storage.write(filePath, markdown);
    const writtenStat = await this.storage.stat(filePath);

    // Insert entity
    this.db
      .insert(entities)
      .values({
        externalId: entityData.externalId,
        entityType: entityData.entityType,
        title: entityData.title,
        data: entityData.data,
        contentHash,
        markdownPath: filePath,
        markdownMtime: writtenStat?.mtimeMs ?? null,
        markdownSize: writtenStat?.size ?? null,
        url: entityData.url ?? null,
      })
      .run();

    const [inserted] = this.db
      .select()
      .from(entities)
      .where(eq(entities.externalId, entityData.externalId))
      .all();

    // Insert tags
    if (entityData.tags?.length) {
      for (const tag of entityData.tags) {
        this.db.insert(entityTags).values({ entityId: inserted.id, tag }).run();
      }
    }

    // Handle attachments
    await this.syncAttachments(inserted.id, entityData);

    // Extract and store outgoing links
    this.syncLinks(inserted.id, filePath, markdown);

    // Add to search index
    this.searchIndexer.updateIndex({
      id: inserted.id,
      externalId: entityData.externalId,
      entityType: entityData.entityType,
      title: entityData.title,
      content: markdown,
      tags: entityData.tags ?? [],
    });

    return { created: 1, updated: 0 };
  }

  private async syncAttachments(
    entityId: number,
    entityData: CrawlerEntityData,
  ): Promise<void> {
    // Remove old attachments
    this.db.delete(attachments).where(eq(attachments.entityId, entityId)).run();

    if (!entityData.attachments?.length) return;

    for (const att of entityData.attachments) {
      const storagePath = att.storagePath ?? `attachments/${entityData.externalId}/${att.filename}`;
      await this.storage.write(storagePath, Buffer.from(att.content));

      this.db
        .insert(attachments)
        .values({
          entityId,
          filename: att.filename,
          mimeType: att.mimeType,
          storagePath,
          backend: "local",
        })
        .run();
    }
  }

  private syncLinks(
    entityId: number,
    markdownPath: string,
    markdown: string,
  ): void {
    const newTargets = new Set(
      extractWikilinks(markdown).map((t) => `${this.markdownBasePath}/${t}.md`),
    );

    const existingRows = this.db
      .select()
      .from(entityLinks)
      .where(eq(entityLinks.sourceEntityId, entityId))
      .all();

    const existingTargets = new Map(existingRows.map((r) => [r.targetPath, r.id]));

    // Delete links that are no longer present
    for (const [target, id] of existingTargets) {
      if (!newTargets.has(target)) {
        this.db.delete(entityLinks).where(eq(entityLinks.id, id)).run();
      }
    }

    // Insert links that are new
    for (const target of newTargets) {
      if (!existingTargets.has(target)) {
        this.db
          .insert(entityLinks)
          .values({
            sourceEntityId: entityId,
            sourceMarkdownPath: markdownPath,
            targetPath: target,
          })
          .run();
      }
    }
  }

  /**
   * Returns a lookupEntityPath callback for use in ThemeRenderContext.
   * Resolves an externalId to its wikilink-compatible path (relative, no .md extension).
   */
  private makeLookupEntityPath(): (externalId: string) => string | undefined {
    return (externalId: string) => {
      const rows = this.db
        .select({ markdownPath: entities.markdownPath })
        .from(entities)
        .where(eq(entities.externalId, externalId))
        .all();
      const markdownPath = rows[0]?.markdownPath;
      if (!markdownPath) return undefined;
      const base = `${this.markdownBasePath}/`;
      const relative = markdownPath.startsWith(base)
        ? markdownPath.slice(base.length)
        : markdownPath;
      return relative.endsWith(".md") ? relative.slice(0, -3) : relative;
    };
  }

  private renderMarkdown(
    entityData: CrawlerEntityData,
    crawlerType: string,
  ): string {
    return this.themeEngine.render({
      entity: {
        externalId: entityData.externalId,
        entityType: entityData.entityType,
        title: entityData.title,
        data: entityData.data,
        url: entityData.url,
        tags: entityData.tags,
      },
      collectionName: this.collectionName,
      crawlerType,
      lookupEntityPath: this.makeLookupEntityPath(),
    });
  }

  private getMarkdownPath(
    entityData: CrawlerEntityData,
    crawlerType: string,
  ): string {
    if (this.themeEngine.has(crawlerType)) {
      const themePath = this.themeEngine.getFilePath({
        entity: {
          externalId: entityData.externalId,
          entityType: entityData.entityType,
          title: entityData.title,
          data: entityData.data,
          url: entityData.url,
          tags: entityData.tags,
        },
        collectionName: this.collectionName,
        crawlerType,
      });
      return `${this.markdownBasePath}/${themePath}`;
    }
    return `${this.markdownBasePath}/${entityData.entityType}/${entityData.externalId}.md`;
  }

  private async reconcile(crawlerType: string): Promise<void> {
    const allEntities = this.db.select().from(entities).all();

    // 1. Ensure every entity in DB has its markdown file on disk with the expected content.
    // Use stored mtime+size to skip files that haven't changed since we last wrote them,
    // avoiding expensive re-renders and reads for unchanged entities.
    for (const entity of allEntities) {
      if (!entity.markdownPath) continue;
      const currentStat = await this.storage.stat(entity.markdownPath);
      if (statMatches(entity, currentStat)) continue;

      // File is missing or has been modified — re-render and restore
      const tags = this.db
        .select()
        .from(entityTags)
        .where(eq(entityTags.entityId, entity.id))
        .all()
        .map((t) => t.tag);
      const expected = this.themeEngine.render({
        entity: {
          externalId: entity.externalId,
          entityType: entity.entityType,
          title: entity.title,
          data: entity.data as Record<string, unknown>,
          url: entity.url ?? undefined,
          tags,
        },
        collectionName: this.collectionName,
        crawlerType,
        lookupEntityPath: this.makeLookupEntityPath(),
      });
      await this.storage.write(entity.markdownPath, expected);
      const writtenStat = await this.storage.stat(entity.markdownPath);
      this.db
        .update(entities)
        .set({
          markdownMtime: writtenStat?.mtimeMs ?? null,
          markdownSize: writtenStat?.size ?? null,
        })
        .where(eq(entities.id, entity.id))
        .run();
    }

    // 2. Delete orphaned markdown files (on disk but no matching entity in DB)
    // Skip paths containing hidden directories (e.g. .git, .obsidian) — those
    // are tool index files that belong to other applications and will be
    // recreated by them; we must not touch them.
    const dbMarkdownPaths = new Set(
      allEntities.map((e) => e.markdownPath).filter(Boolean),
    );
    try {
      const diskMarkdownFiles = await this.storage.list(this.markdownBasePath);
      for (const diskPath of diskMarkdownFiles) {
        if (isToolPath(diskPath)) continue;
        if (!dbMarkdownPaths.has(diskPath)) {
          try {
            await this.storage.delete(diskPath);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // markdown directory may not exist yet
    }

    // 3. Delete orphaned attachment files (on disk but no matching record in DB)
    const allAttachmentRows = this.db.select().from(attachments).all();
    const dbAttachmentPaths = new Set(
      allAttachmentRows.map((a) => a.storagePath),
    );
    try {
      const diskAttachmentFiles = await this.storage.list("attachments");
      for (const diskPath of diskAttachmentFiles) {
        if (isToolPath(diskPath)) continue;
        if (!dbAttachmentPaths.has(diskPath)) {
          try {
            await this.storage.delete(diskPath);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // attachments directory may not exist yet
    }

    // 4. Clean up attachment DB records whose files are missing from disk
    for (const att of allAttachmentRows) {
      const exists = await this.storage.exists(att.storagePath);
      if (!exists) {
        this.db.delete(attachments).where(eq(attachments.id, att.id)).run();
      }
    }
  }

  private async deleteEntity(externalId: string): Promise<boolean> {
    const [existing] = this.db
      .select()
      .from(entities)
      .where(eq(entities.externalId, externalId))
      .all();

    if (!existing) return false;

    // Delete markdown file
    if (existing.markdownPath) {
      try {
        await this.storage.delete(existing.markdownPath);
      } catch {
        // File may already be gone
      }
    }

    // Delete related records
    this.db.delete(entityTags).where(eq(entityTags.entityId, existing.id)).run();
    this.db.delete(attachments).where(eq(attachments.entityId, existing.id)).run();
    this.db.delete(entityLinks).where(eq(entityLinks.sourceEntityId, existing.id)).run();
    this.db
      .delete(entityRelations)
      .where(eq(entityRelations.sourceEntityId, existing.id))
      .run();
    this.db
      .delete(entityRelations)
      .where(eq(entityRelations.targetEntityId, existing.id))
      .run();
    this.db.delete(entities).where(eq(entities.id, existing.id)).run();

    // Remove from search index
    this.searchIndexer.removeIndex(existing.id);

    return true;
  }
}
