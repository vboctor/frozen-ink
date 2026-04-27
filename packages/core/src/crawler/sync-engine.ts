import { eq, and } from "drizzle-orm";
import { createCryptoHasher } from "../compat/crypto";
import { getCollectionDb } from "../db/client";
import { entities, syncErrors } from "../db/collection-schema";
import type { EntityData } from "../db/collection-schema";
import { MetadataStore } from "../db/metadata";
import { getCollection, updateCollection } from "../config/context";
import { SearchIndexer } from "../search/indexer";
import { computeEntityHash } from "../sync/entity-hash";
import type { Crawler, CrawlerEntityData, SyncCursor } from "./interface";
import type { FolderConfig } from "../theme/interface";
import type { ThemeEngine } from "../theme/engine";
import type { StorageBackend } from "../storage/interface";

/** Serialize a FolderConfig to yml content (only non-default fields). */
function serializeFolderConfig(config: FolderConfig): string {
  const lines: string[] = [];
  if (config.visible === false) lines.push("visible: false");
  if (config.sort === "DESC") lines.push("sort: DESC");
  if (config.hide && config.hide.length > 0) {
    lines.push(`hide: [${config.hide.join(", ")}]`);
  }
  if (config.showCount === true) lines.push("showCount: true");
  return lines.join("\n") + "\n";
}

/** Returns true if any path segment starts with "." (hidden dirs like .git, .obsidian). */
function isToolPath(filePath: string): boolean {
  return filePath.split("/").some((segment) => segment.startsWith("."));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withEntityContext(err: unknown, entity: Pick<CrawlerEntityData, "entityType" | "externalId">): Error {
  const context = `entity type=${entity.entityType} id=${entity.externalId}`;
  const message = errorMessage(err);
  if (message.includes(context)) {
    return err instanceof Error ? err : new Error(message);
  }
  const wrapped = new Error(`Failed to process ${context}: ${message}`);
  (wrapped as Error & { cause?: unknown }).cause = err;
  return wrapped;
}


/**
 * Extract internal link targets from rendered markdown.
 * Returns unique target strings as root-relative paths (without .md extension).
 *
 * @param markdown  The markdown content to extract links from.
 * @param sourceFilePath  The markdown file's path relative to the markdown root
 *   (e.g. "commits/abc.md"). When provided, relative links are resolved to
 *   root-relative paths. When omitted, relative prefixes are stripped as a best-effort.
 */
export function extractWikilinks(markdown: string, sourceFilePath?: string): string[] {
  const targets = new Set<string>();

  // Standard markdown links: [label](target.md) — exclude images, external URLs, and anchors.
  const mdLinkRegex = /(?<!!)\[([^\]]*)\]\((?!https?:\/\/|mailto:|#)([^)]+\.md)(?:#[^)]*)?\)/g;
  let match;
  while ((match = mdLinkRegex.exec(markdown)) !== null) {
    let target = match[2].replace(/\.md$/, "").trim();
    if (!target) continue;
    // Resolve relative path to root-relative
    if (sourceFilePath && (target.startsWith("../") || !target.includes("/"))) {
      const sourceDir = sourceFilePath.replace(/\/[^/]+$/, "");
      const parts = (sourceDir ? `${sourceDir}/${target}` : target).split("/");
      const resolved: string[] = [];
      for (const p of parts) {
        if (p === "..") resolved.pop();
        else if (p !== "." && p !== "") resolved.push(p);
      }
      target = resolved.join("/");
    }
    if (target) targets.add(target);
  }

  // Legacy Obsidian wikilinks: [[target|label]] — for backward compatibility with vault content.
  const wikiRegex = /(?<!!)\[\[([^\]|]+?)(?:[#^][^\]|]*)?(?:\|[^\]]+?)?\]\]/g;
  while ((match = wikiRegex.exec(markdown)) !== null) {
    const target = match[1].trim();
    if (target) targets.add(target);
  }

  return Array.from(targets);
}

/** Default file extensions allowed for asset downloads. */
/** Empty = no extension filter (all file types allowed). */
const DEFAULT_ASSET_EXTENSIONS: string[] = [];

/** Default max asset size: 10 MB in KB. */
const DEFAULT_ASSET_MAX_SIZE_KB = 10240;

/**
 * Per-entity retry cap. Once an entity has failed this many times across
 * runs, the SyncEngine stops handing it back to the crawler as a retry
 * candidate. The journal row is kept (so the count stays visible in the UI)
 * but it no longer slows down every subsequent incremental sync.
 */
const MAX_ENTITY_ATTEMPTS = 3;

export interface AssetConfig {
  /** Allowed file extensions (with dot). */
  extensions?: string[];
  /** Maximum file size in KB. */
  maxSize?: number;
}

export interface SyncEngineOptions {
  crawler: Crawler;
  dbPath: string;
  collectionName: string;
  themeEngine: ThemeEngine;
  storage: StorageBackend;
  markdownBasePath: string;
  /** Asset download filtering config. */
  assetConfig?: AssetConfig;
  onEntityProcessed?: (info: {
    collectionName: string;
    externalId: string;
    created: boolean;
    updated: boolean;
  }) => void;
  onBatchFetched?: (info: {
    collectionName: string;
    externalIds: string[];
    entityTypes: string[];
  }) => void;
  /** Called after a successful sync with the crawler version, so callers can update .config. */
  onVersionUpdate?: (version: string) => void;
  /** Called with human-readable status messages describing what the sync is doing. */
  onProgress?: (message: string) => void;
}

export class SyncEngine {
  private crawler: Crawler;
  private db: ReturnType<typeof getCollectionDb>;
  private dbPath: string;
  private collectionName: string;
  private themeEngine: ThemeEngine;
  private storage: StorageBackend;
  private markdownBasePath: string;
  private searchIndexer: SearchIndexer;
  private allowedExtensions: Set<string>;
  private maxAssetSizeBytes: number;
  private onEntityProcessed?: SyncEngineOptions["onEntityProcessed"];
  private onBatchFetched?: SyncEngineOptions["onBatchFetched"];
  private onVersionUpdate?: SyncEngineOptions["onVersionUpdate"];
  private onProgress?: SyncEngineOptions["onProgress"];

  /**
   * Check version compatibility between a collection and crawler.
   * Returns "compatible" (same major), "rerender" (same major, different minor), or "full-sync" (different major).
   */
  static checkVersionCompat(collectionVersion: string, crawlerVersion: string): "compatible" | "rerender" | "full-sync" {
    const [colMajor, colMinor] = (collectionVersion || "1.0").split(".").map(Number);
    const [crwMajor, crwMinor] = (crawlerVersion || "1.0").split(".").map(Number);
    if (colMajor !== crwMajor) return "full-sync";
    if (colMinor !== crwMinor) return "rerender";
    return "compatible";
  }

  constructor(options: SyncEngineOptions) {
    this.crawler = options.crawler;
    this.db = getCollectionDb(options.dbPath);
    this.dbPath = options.dbPath;
    this.collectionName = options.collectionName;
    this.themeEngine = options.themeEngine;
    this.storage = options.storage;
    this.markdownBasePath = options.markdownBasePath;
    this.searchIndexer = new SearchIndexer(options.dbPath);
    const ac = options.assetConfig;
    this.allowedExtensions = new Set(
      (ac?.extensions ?? DEFAULT_ASSET_EXTENSIONS).map((e) => e.toLowerCase()),
    );
    this.maxAssetSizeBytes = (ac?.maxSize ?? DEFAULT_ASSET_MAX_SIZE_KB) * 1024;
    this.onEntityProcessed = options.onEntityProcessed;
    this.onBatchFetched = options.onBatchFetched;
    this.onVersionUpdate = options.onVersionUpdate;
    this.onProgress = options.onProgress;
  }

  async run(options?: { syncType?: "full" | "incremental" }): Promise<{ created: number; updated: number; deleted: number }> {
    const crawlerType = this.crawler.metadata.type;
    const startedAt = new Date().toISOString().replace("T", " ").replace("Z", "");
    const syncType = options?.syncType ?? "incremental";

    // Pass asset filter to the crawler so it can skip downloads pre-emptively
    this.crawler.setAssetFilter?.({
      maxSizeBytes: this.maxAssetSizeBytes,
      allowedExtensions: this.allowedExtensions,
    });
    // Forward progress messages from the crawler to the UI.
    if (this.onProgress) {
      this.crawler.setProgressCallback?.(this.onProgress);
    }
    // Hand the crawler the existing external-id set so it can skip re-fetching
    // entities we already have (e.g. user profiles for returning contributors).
    if (this.crawler.setExistingExternalIds) {
      const rows = this.db.select({ externalId: entities.externalId }).from(entities).all();
      this.crawler.setExistingExternalIds(new Set(rows.map((r: { externalId: string }) => r.externalId)));
    }

    // Hand the crawler the set of externalIds that previously failed so it
    // can re-attempt them at the start of this run. Entries that have already
    // failed MAX_ENTITY_ATTEMPTS times are skipped — their journal row stays
    // (so the count is still visible to the user) but they no longer add
    // work to every incremental sync. On success the row is cleared below.
    if (this.crawler.setRetryExternalIds) {
      const failedRows = this.db
        .select({ externalId: syncErrors.externalId, attempts: syncErrors.attempts })
        .from(syncErrors)
        .all() as Array<{ externalId: string; attempts: number }>;
      const retryable = failedRows
        .filter((r) => (r.attempts ?? 0) < MAX_ENTITY_ATTEMPTS)
        .map((r) => r.externalId);
      if (retryable.length > 0) {
        this.crawler.setRetryExternalIds(new Set(retryable));
      }
    }

    const metadata = new MetadataStore(this.dbPath);

    // Mirror user-facing config fields from YAML into the DB so consumers
    // that only have the DB (published worker, remote UIs) can read them.
    const colYaml = getCollection(this.collectionName);
    metadata.setCollectionTitle(colYaml?.title ?? null);
    metadata.setCollectionDescription(colYaml?.description ?? null);
    metadata.setCollectionVersion(colYaml?.version ?? null);

    // Mark sync as running
    metadata.setSyncState({ lastStatus: "running", lastAt: startedAt });

    let created = 0;
    let updated = 0;
    let deleted = 0;
    const errors: unknown[] = [];

    try {
      // Load cursor from DB metadata; version remains in YAML as a user-authored field
      let cursor: SyncCursor | null = (metadata.getSyncState().cursor as SyncCursor) ?? null;

      // Version check: compare stored version with crawler's current version
      const currentVersion = this.crawler.metadata.version ?? "1.0";
      const storedVersion = colYaml?.version ?? "1.0";
      const [curMajor, curMinor] = currentVersion.split(".").map(Number);
      const [stoMajor, stoMinor] = storedVersion.split(".").map(Number);

      if (curMajor !== stoMajor) {
        // Major version change: force full re-sync (clear cursor)
        cursor = null;
      } else if (curMinor !== stoMinor) {
        // Minor version change: re-render all markdown from stored entity data
        await this.reRenderAllEntities(crawlerType);
      }

      // Sync loop
      let hasMore = true;
      let pausedByRateLimit = false;
      while (hasMore) {
        let result: Awaited<ReturnType<Crawler["sync"]>>;
        try {
          result = await this.crawler.sync(cursor);
        } catch (err) {
          // RateLimitPauseError signals the crawler hit a wait longer than
          // what's safe to sleep through inline (e.g. in a Workers request).
          // Persist the cursor and exit cleanly so the next sync tick resumes.
          if (err instanceof Error && err.name === "RateLimitPauseError") {
            pausedByRateLimit = true;
            this.onProgress?.(err.message);
            break;
          }
          throw err;
        }
        this.onBatchFetched?.({
          collectionName: this.collectionName,
          externalIds: result.entities.map((e) => e.externalId),
          entityTypes: result.entities.map((e) => e.entityType),
        });

        // Record per-entity failures into the journal (sync_errors). The
        // sync continues regardless — the journal preserves visibility and
        // lets the user resume retries later. Per-entity attempts are capped
        // at MAX_ENTITY_ATTEMPTS so the same broken records don't slow down
        // every incremental sync forever.
        const failed = result.failedEntities ?? [];
        for (const f of failed) {
          this.recordSyncError(f.externalId, f.entityType, f.error);
        }

        // Process entities (links are deferred until all entities exist)
        const deferredLinks: Array<{
          entityId: number;
          entityType: string;
          externalId: string;
          markdown: string;
          markdownPath?: string;
        }> = [];
        for (const entityData of result.entities) {
          let counts: { created: number; updated: number };
          try {
            counts = await this.upsertEntity(entityData, crawlerType, deferredLinks);
          } catch (err) {
            throw withEntityContext(err, entityData);
          }
          created += counts.created;
          updated += counts.updated;
          // Successful sync: clear any prior journal entry for this entity.
          this.clearSyncError(entityData.externalId);
          this.onEntityProcessed?.({
            collectionName: this.collectionName,
            externalId: entityData.externalId,
            created: counts.created > 0,
            updated: counts.updated > 0,
          });
        }

        // Sync links now that all entities in the batch exist
        for (const { entityId, entityType, externalId, markdown, markdownPath } of deferredLinks) {
          try {
            this.syncLinks(entityId, markdown, markdownPath);
            this.recomputeHash(entityId);
          } catch (err) {
            throw withEntityContext(err, { entityType, externalId });
          }
        }

        // Handle deletions
        for (const externalId of result.deletedExternalIds) {
          const didDelete = await this.deleteEntity(externalId);
          if (didDelete) deleted++;
        }

        // Update cursor and persist after every successful batch so resume
        // works even if the next call crashes the process. Cost is a single
        // metadata write per page — negligible vs. fetching the page.
        if (result.nextCursor) {
          cursor = result.nextCursor;
        }
        metadata.setSyncState({ cursor: cursor ?? null });

        hasMore = result.hasMore;
      }

      if (pausedByRateLimit) {
        // Don't bump version, reconcile (would delete unsynced entities as
        // orphans), or write folder configs — the sync is mid-flight. Mark
        // as failed so the UI shows an incomplete state and the next run
        // resumes from the persisted cursor.
        metadata.setSyncState({
          lastStatus: "failed",
          lastAt: new Date().toISOString().replace("T", " ").replace("Z", ""),
          lastCreated: created,
          lastUpdated: updated,
          lastDeleted: deleted,
          lastErrors: ["Paused due to rate limit; will resume on next sync"],
          errorCount: this.countSyncErrors(),
          failureReason: "rate_limit",
        });
        return { created, updated, deleted };
      }

      // Sync completed normally. The cursor was already persisted on the last
      // batch above and now carries the incremental watermark (e.g. updatedSince
      // for MantisHub) that the next incremental run will use. Don't clear it.

      metadata.setCollectionVersion(currentVersion);
      updateCollection(this.collectionName, { version: currentVersion });

      // Reconcile filesystem with DB — orphan cleanup only. Entity markdown is
      // already written during the sync loop, so there's no need to re-render.
      await this.reconcile();

      // Write folder config yml files (visible/sort settings)
      this.onProgress?.("Writing folder config files");
      await this.writeFolderConfigFiles(crawlerType);

      // Notify caller to update collection version in .config
      this.onVersionUpdate?.(currentVersion);

      // Update sync state in DB metadata
      metadata.setSyncState({
        lastStatus: "completed",
        lastAt: new Date().toISOString().replace("T", " ").replace("Z", ""),
        lastCreated: created,
        lastUpdated: updated,
        lastDeleted: deleted,
        lastErrors: errors.length > 0 ? errors : null,
        errorCount: this.countSyncErrors(),
        failureReason: null,
      });

      return { created, updated, deleted };
    } catch (err) {
      errors.push(String(err));
      metadata.setSyncState({
        lastStatus: "failed",
        lastAt: new Date().toISOString().replace("T", " ").replace("Z", ""),
        lastCreated: created,
        lastUpdated: updated,
        lastDeleted: deleted,
        lastErrors: errors,
        errorCount: this.countSyncErrors(),
        failureReason: "fatal",
      });
      throw err;
    } finally {
      metadata.close();
    }
  }

  /**
   * Record a recoverable per-entity sync failure. Increments the attempt
   * counter on existing rows; inserts a new row otherwise. The journal is
   * read on the next sync to feed retry IDs back to the crawler.
   */
  private recordSyncError(externalId: string, entityType: string, error: string): void {
    const [existing] = this.db
      .select({ attempts: syncErrors.attempts })
      .from(syncErrors)
      .where(eq(syncErrors.externalId, externalId))
      .all();
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    if (existing) {
      this.db
        .update(syncErrors)
        .set({ error, attempts: (existing.attempts ?? 0) + 1, lastSeenAt: now })
        .where(eq(syncErrors.externalId, externalId))
        .run();
    } else {
      this.db
        .insert(syncErrors)
        .values({ externalId, entityType, error, attempts: 1, firstSeenAt: now, lastSeenAt: now })
        .run();
    }
  }

  /** Remove a journal entry — called when the entity successfully syncs. */
  private clearSyncError(externalId: string): void {
    this.db.delete(syncErrors).where(eq(syncErrors.externalId, externalId)).run();
  }

  /** Total number of unresolved sync failures in the journal. */
  private countSyncErrors(): number {
    const rows = this.db.select({ id: syncErrors.externalId }).from(syncErrors).all();
    return rows.length;
  }

  private async updateEntityData(entityId: number, updates: Partial<EntityData>): Promise<void> {
    const [row] = this.db.select({ data: entities.data }).from(entities).where(eq(entities.id, entityId)).all();
    const current = (row?.data as EntityData) ?? { source: {} };
    this.db.update(entities).set({ data: { ...current, ...updates } }).where(eq(entities.id, entityId)).run();
  }

  private recomputeHash(entityId: number): void {
    const [row] = this.db.select().from(entities).where(eq(entities.id, entityId)).all();
    if (!row) return;
    const hash = computeEntityHash({
      entityType: row.entityType,
      title: row.title,
      folder: row.folder ?? null,
      slug: row.slug ?? null,
      data: row.data as EntityData,
    });
    this.db.update(entities).set({ contentHash: hash }).where(eq(entities.id, entityId)).run();
  }

  private async upsertEntity(
    entityData: CrawlerEntityData,
    crawlerType: string,
    deferredLinks?: Array<{
      entityId: number;
      entityType: string;
      externalId: string;
      markdown: string;
      markdownPath?: string;
    }>,
  ): Promise<{ created: number; updated: number }> {
    // Build initial EntityData with source from the crawler
    const initialData: EntityData = {
      source: entityData.data as Record<string, unknown>,
    };

    // Check if entity already exists
    const [existing] = this.db
      .select()
      .from(entities)
      .where(eq(entities.externalId, entityData.externalId))
      .all();

    if (existing) {
      const existingData = (existing.data as EntityData) ?? { source: {} };

      // Compare source data to decide if re-render is needed
      const sourceChanged = JSON.stringify(entityData.data) !== JSON.stringify(existingData.source);

      // A title change drives a different rendered markdown (since the
      // title appears in the body), so treat it like a source change and
      // fall through to the full re-render path. Tag-only drift is handled
      // cheaply in place: the rendered markdown doesn't depend on tags, so
      // we just refresh the FTS tags column without re-rendering.
      const titleChanged = existing.title !== entityData.title;
      if (!sourceChanged && !titleChanged) {
        const newTags = entityData.tags ?? [];
        const oldTags = existingData.tags ?? [];
        const tagsChanged = JSON.stringify(newTags) !== JSON.stringify(oldTags);
        // Update url and tags in data
        await this.updateEntityData(existing.id, {
          url: entityData.url ?? null,
          tags: newTags,
        });
        // Keep FTS in sync with the DB row.
        if (tagsChanged) {
          this.searchIndexer.refreshTitleAndTags(existing.id, entityData.title, newTags);
        }
        // Handle assets (update data.assets)
        await this.syncAssets(existing.id, entityData);

        // Restore the markdown file if it was deleted from disk. Cheap: one
        // existence check per entity; only re-renders when actually missing.
        if (existing.folder != null && existing.slug != null) {
          const filePath = existing.folder ? `${existing.folder}/${existing.slug}.md` : `${existing.slug}.md`;
          const storagePath = this.toStoragePath(filePath);
          let fileExists = true;
          try {
            await this.storage.read(storagePath);
          } catch {
            fileExists = false;
          }
          if (!fileExists) {
            const markdown = this.renderMarkdown(entityData, crawlerType);
            await this.storage.write(storagePath, markdown);
          }
        }

        // Defer link syncing
        if (deferredLinks) {
          // We need to re-read the markdown to re-sync links, but source hasn't changed
          // so we can skip re-rendering. Just re-sync links from existing markdown if any.
          // For simplicity when source unchanged, we skip link re-sync (links were set before).
        }
        return { created: 0, updated: 0 };
      }

      // Render markdown
      const markdown = this.renderMarkdown(entityData, crawlerType);
      const filePath = this.getMarkdownPath(entityData, crawlerType);
      const storagePath = this.toStoragePath(filePath);
      await this.storage.write(storagePath, markdown);

      // Extract folder/slug from the new file path
      const lastSlashU = filePath.lastIndexOf("/");
      const newFolder = lastSlashU >= 0 ? filePath.slice(0, lastSlashU) : "";
      const newSlug = filePath.slice(lastSlashU + 1).replace(/\.md$/, "");

      // If the file path changed (e.g. title/name rename), delete the old file.
      const oldPath = existing.folder != null && existing.slug != null
        ? (existing.folder ? `${existing.folder}/${existing.slug}.md` : `${existing.slug}.md`)
        : null;
      if (oldPath && oldPath !== filePath) {
        try {
          await this.storage.delete(this.toStoragePath(oldPath));
        } catch {
          // Old file may already be gone — ignore.
        }
      }

      // Build updated EntityData preserving existing links/assets until sync
      const updatedData: EntityData = {
        ...existingData,
        source: entityData.data as Record<string, unknown>,
        url: entityData.url ?? null,
        tags: entityData.tags ?? [],
      };

      // Update entity
      this.db
        .update(entities)
        .set({
          title: entityData.title,
          entityType: entityData.entityType,
          data: updatedData,
          folder: newFolder,
          slug: newSlug,
          updatedAt: new Date().toISOString().replace("T", " ").replace("Z", ""),
        })
        .where(eq(entities.id, existing.id))
        .run();

      // Handle assets
      await this.syncAssets(existing.id, entityData);

      // Defer link syncing until all entities in the batch exist
      if (deferredLinks) {
        deferredLinks.push({
          entityId: existing.id,
          entityType: entityData.entityType,
          externalId: entityData.externalId,
          markdown,
          markdownPath: filePath,
        });
      } else {
        this.syncLinks(existing.id, markdown, filePath);
        this.recomputeHash(existing.id);
      }

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
    const storagePath = this.toStoragePath(filePath);
    await this.storage.write(storagePath, markdown);

    // Extract folder/slug from the file path
    const lastSlashN = filePath.lastIndexOf("/");
    const newFolder = lastSlashN >= 0 ? filePath.slice(0, lastSlashN) : "";
    const newSlug = filePath.slice(lastSlashN + 1).replace(/\.md$/, "");

    // Build EntityData
    const newData: EntityData = {
      source: entityData.data as Record<string, unknown>,
      url: entityData.url ?? null,
      tags: entityData.tags ?? [],
    };

    // Insert entity
    this.db
      .insert(entities)
      .values({
        externalId: entityData.externalId,
        entityType: entityData.entityType,
        title: entityData.title,
        data: newData,
        folder: newFolder,
        slug: newSlug,
      })
      .run();

    const [inserted] = this.db
      .select()
      .from(entities)
      .where(eq(entities.externalId, entityData.externalId))
      .all();

    // Handle assets
    await this.syncAssets(inserted.id, entityData);

    // Defer link syncing until all entities in the batch exist
    if (deferredLinks) {
      deferredLinks.push({
        entityId: inserted.id,
        entityType: entityData.entityType,
        externalId: entityData.externalId,
        markdown,
        markdownPath: filePath,
      });
    } else {
      this.syncLinks(inserted.id, markdown, filePath);
      this.recomputeHash(inserted.id);
    }

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

  /** Get tag names for an entity from data.tags. */
  private getEntityTagNames(entityId: number): string[] {
    const [row] = this.db
      .select({ data: entities.data })
      .from(entities)
      .where(eq(entities.id, entityId))
      .all();
    return ((row?.data as EntityData)?.tags) ?? [];
  }

  /** Check if a filename has an allowed image extension. */
  private isAllowedAsset(filename: string): boolean {
    if (this.allowedExtensions.size === 0) return true;
    const dot = filename.lastIndexOf(".");
    if (dot === -1) return false;
    return this.allowedExtensions.has(filename.slice(dot).toLowerCase());
  }

  private async syncAssets(
    entityId: number,
    entityData: CrawlerEntityData,
  ): Promise<void> {
    if (!entityData.attachments?.length) {
      await this.updateEntityData(entityId, { assets: [] });
      return;
    }

    const assetEntries: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }> = [];

    for (const att of entityData.attachments) {
      const storagePath = att.storagePath ?? `${this.markdownBasePath}/${entityData.entityType}/assets/${att.filename}`;

      const shouldDownload =
        this.isAllowedAsset(att.filename) &&
        att.content.length <= this.maxAssetSizeBytes;

      if (shouldDownload) {
        await this.storage.write(storagePath, Buffer.from(att.content));
      }

      const hasher = createCryptoHasher("sha256");
      hasher.update(Buffer.from(att.content));
      const hash = hasher.digest("hex");

      assetEntries.push({
        filename: att.filename,
        mimeType: att.mimeType,
        storagePath,
        hash,
      });
    }

    await this.updateEntityData(entityId, { assets: assetEntries });
  }

  private syncLinks(
    entityId: number,
    markdown: string,
    markdownPath?: string,
  ): void {
    const wikiTargets = extractWikilinks(markdown, markdownPath);
    const outLinkExternalIds: string[] = [];

    // Get the source entity's externalId for updating inLinks on targets
    const [sourceEntity] = this.db
      .select({ externalId: entities.externalId })
      .from(entities)
      .where(eq(entities.id, entityId))
      .all();
    const sourceExternalId = sourceEntity?.externalId;

    // Pre-load all entities for path lookup via folder/slug columns
    const allForLinks = this.db
      .select({ id: entities.id, externalId: entities.externalId, data: entities.data, folder: entities.folder, slug: entities.slug })
      .from(entities)
      .all();
    type LinkRow = { id: number; externalId: string; data: unknown };
    const byMarkdownPath = new Map<string, LinkRow>();
    for (const r of allForLinks) {
      if (r.folder != null && r.slug != null) {
        const mdPath = r.folder ? `${r.folder}/${r.slug}.md` : `${r.slug}.md`;
        byMarkdownPath.set(mdPath, { id: r.id, externalId: r.externalId, data: r.data });
      }
    }

    for (const target of wikiTargets) {
      const targetPath = `${target}.md`;
      const targetEntity = byMarkdownPath.get(targetPath);
      if (targetEntity && targetEntity.id !== entityId) {
        outLinkExternalIds.push(targetEntity.externalId);
        // Add source to target's inLinks if not already present
        if (sourceExternalId) {
          const targetData = (targetEntity.data as EntityData) ?? { source: {} };
          const currentInLinks: string[] = targetData.in_links ?? [];
          if (!currentInLinks.includes(sourceExternalId)) {
            this.db
              .update(entities)
              .set({ data: { ...targetData, in_links: [...currentInLinks, sourceExternalId] } })
              .where(eq(entities.id, targetEntity.id))
              .run();
          }
        }
      }
    }

    // Update out_links in data
    const [sourceRow] = this.db.select({ data: entities.data }).from(entities).where(eq(entities.id, entityId)).all();
    const sourceData = (sourceRow?.data as EntityData) ?? { source: {} };
    this.db
      .update(entities)
      .set({ data: { ...sourceData, out_links: outLinkExternalIds } })
      .where(eq(entities.id, entityId))
      .run();
  }

  /**
   * Returns a lookupEntityPath callback for use in ThemeRenderContext.
   * Resolves an externalId to its wikilink-compatible path (relative, no .md extension).
   */
  private makeLookupEntityPath(): (externalId: string) => string | undefined {
    return (externalId: string) => {
      const rows = this.db
        .select({ folder: entities.folder, slug: entities.slug })
        .from(entities)
        .where(eq(entities.externalId, externalId))
        .all();
      const r = rows[0];
      if (!r || r.folder == null || r.slug == null) return undefined;
      return r.folder ? `${r.folder}/${r.slug}` : r.slug;
    };
  }

  private makeLookupEntityTitle(): (externalId: string) => string | undefined {
    return (externalId: string) => {
      const rows = this.db
        .select({ title: entities.title })
        .from(entities)
        .where(eq(entities.externalId, externalId))
        .all();
      return rows[0]?.title ?? undefined;
    };
  }

  /**
   * Build a wikilink resolver that supports Obsidian-style stem matching.
   * "Topic" matches an entity whose externalId ends with "/Topic.md" or is "Topic.md".
   */
  private makeResolveWikilink(): (target: string) => string | undefined {
    const allRows = this.db
      .select({ externalId: entities.externalId, folder: entities.folder, slug: entities.slug })
      .from(entities)
      .all();

    const byExternalId = new Map<string, string>();
    const byStem = new Map<string, string>();

    for (const row of allRows) {
      if (row.folder == null || row.slug == null) continue;
      const withoutExt = row.folder ? `${row.folder}/${row.slug}` : row.slug;

      byExternalId.set(row.externalId, withoutExt);

      // Stem key: filename without path and extension
      const idWithoutExt = row.externalId.replace(/\.md$/, "");
      const stemName = idWithoutExt.includes("/") ? idWithoutExt.split("/").pop()! : idWithoutExt;
      if (!byStem.has(stemName)) {
        byStem.set(stemName, withoutExt);
      }
    }

    return (target: string) => {
      const clean = target.replace(/[#^].*$/, "").trim();
      if (!clean) return undefined;

      // Try exact externalId match (with and without .md)
      const withMd = clean.endsWith(".md") ? clean : `${clean}.md`;
      if (byExternalId.has(withMd)) return byExternalId.get(withMd);
      if (byExternalId.has(clean)) return byExternalId.get(clean);

      // Stem match: bare filename without path
      const stemName = clean.includes("/") ? clean.split("/").pop()! : clean;
      return byStem.get(stemName);
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
      lookupEntityTitle: this.makeLookupEntityTitle(),
      resolveWikilink: this.makeResolveWikilink(),
    });
  }

  private getMarkdownPath(
    entityData: CrawlerEntityData,
    crawlerType: string,
  ): string {
    if (this.themeEngine.has(crawlerType)) {
      return this.themeEngine.getFilePath({
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
    }
    return `${entityData.entityType}/${entityData.externalId}.md`;
  }

  private toStoragePath(markdownPath: string): string {
    return `${this.markdownBasePath}/${markdownPath}`;
  }

  /**
   * Re-render all markdown files from stored entity data (for minor version bumps).
   * Does not re-download from the API — just re-generates markdown from the JSON in the DB.
   */
  private async reRenderAllEntities(crawlerType: string): Promise<void> {
    const allEntities = this.db.select().from(entities).all();
    for (const row of allEntities) {
      try {
        const rowData = (row.data as EntityData) ?? { source: {} };
        // Re-derive title from stored data via the theme (no API call needed).
        const derivedTitle = this.themeEngine.getTitle({
          entity: {
            externalId: row.externalId,
            entityType: row.entityType,
            title: row.title,
            data: rowData.source,
            url: rowData.url ?? undefined,
          },
          collectionName: this.collectionName,
          crawlerType,
        });
        const title = derivedTitle ?? row.title;

        const entityData: CrawlerEntityData = {
          externalId: row.externalId,
          entityType: row.entityType,
          title,
          data: rowData.source,
          url: rowData.url ?? undefined,
        };
        const markdown = this.renderMarkdown(entityData, crawlerType);
        const filePath = this.getMarkdownPath(entityData, crawlerType);
        const storagePath = this.toStoragePath(filePath);
        await this.storage.write(storagePath, markdown);

        const lastSlashR = filePath.lastIndexOf("/");
        const reFolder = lastSlashR >= 0 ? filePath.slice(0, lastSlashR) : "";
        const reSlug = filePath.slice(lastSlashR + 1).replace(/\.md$/, "");

        // Delete old file if path changed
        const oldPath = row.folder != null && row.slug != null
          ? (row.folder ? `${row.folder}/${row.slug}.md` : `${row.slug}.md`)
          : null;
        if (oldPath && oldPath !== filePath) {
          try { await this.storage.delete(this.toStoragePath(oldPath)); } catch { /* ignore */ }
        }

        this.db
          .update(entities)
          .set({ title, folder: reFolder, slug: reSlug })
          .where(eq(entities.id, row.id))
          .run();

        // Re-sync wikilinks
        this.syncLinks(row.id, markdown, filePath);
        this.recomputeHash(row.id);

        // Update search index
        this.searchIndexer.updateIndex({
          id: row.id,
          externalId: row.externalId,
          entityType: row.entityType,
          title,
          content: markdown,
          tags: [],
        });
      } catch (err) {
        throw withEntityContext(err, { entityType: row.entityType, externalId: row.externalId });
      }
    }
  }

  private async reconcile(): Promise<void> {
    const allEntities = this.db.select().from(entities).all();

    // Note: entity markdown is written by upsertEntity during the sync loop.
    // Reconcile only handles orphan cleanup — do NOT re-render every entity
    // here; that would be equivalent to running `generate` and is wasteful
    // for incremental syncs (which may only touch a handful of entities).

    // Delete orphaned markdown files (on disk but no matching entity in DB)
    // Skip paths containing hidden directories (e.g. .git, .obsidian) — those
    // are tool index files that belong to other applications and will be
    // recreated by them; we must not touch them.
    const dbStoragePaths = new Set<string>();
    for (const e of allEntities) {
      if (e.folder != null && e.slug != null) {
        const mp = e.folder ? `${e.folder}/${e.slug}.md` : `${e.slug}.md`;
        dbStoragePaths.add(this.toStoragePath(mp));
      }
    }
    const dbAssetStoragePaths = new Set<string>();
    for (const entity of allEntities) {
      const entityData = (entity.data as EntityData) ?? { source: {} };
      const entityAssets: Array<{ storagePath: string }> = entityData.assets ?? [];
      for (const att of entityAssets) dbAssetStoragePaths.add(att.storagePath);
    }
    this.onProgress?.("Scanning filesystem for orphaned markdown files");
    let orphanedMd = 0;
    try {
      const diskMarkdownFiles = await this.storage.list(this.markdownBasePath);
      for (const diskPath of diskMarkdownFiles) {
        if (isToolPath(diskPath)) continue;
        if (diskPath.endsWith(".yml")) continue;
        if (dbAssetStoragePaths.has(diskPath)) continue;
        if (!dbStoragePaths.has(diskPath)) {
          try {
            await this.storage.delete(diskPath);
            orphanedMd++;
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // markdown directory may not exist yet
    }
    if (orphanedMd > 0) {
      this.onProgress?.(`Removed ${orphanedMd} orphaned markdown file(s)`);
    }

    // Delete orphaned asset files (on disk but no matching record in entity JSON)
    const dbAssetPaths = new Set<string>();
    const assetDirs = new Set<string>();
    for (const entity of allEntities) {
      const entityData = (entity.data as EntityData) ?? { source: {} };
      const entityAssets: Array<{ storagePath: string }> = entityData.assets ?? [];
      for (const att of entityAssets) {
        dbAssetPaths.add(att.storagePath);
        const parts = att.storagePath.split("/");
        if (parts.length > 1) {
          assetDirs.add(parts.slice(0, -1).join("/"));
        }
      }
    }
    for (const dir of ["content/assets", "assets", "attachments"]) {
      assetDirs.add(dir);
    }
    this.onProgress?.("Scanning filesystem for orphaned asset files");
    let orphanedAssets = 0;
    for (const assetsDir of assetDirs) {
      try {
        const diskAssetFiles = await this.storage.list(assetsDir);
        for (const diskPath of diskAssetFiles) {
          if (isToolPath(diskPath)) continue;
          if (!dbAssetPaths.has(diskPath)) {
            try {
              await this.storage.delete(diskPath);
              orphanedAssets++;
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // directory may not exist yet
      }
    }
    if (orphanedAssets > 0) {
      this.onProgress?.(`Removed ${orphanedAssets} orphaned asset file(s)`);
    }
  }

  /**
   * Write <folder-name>.yml config files for all folders whose leaf name matches
   * a key in the theme's folderConfigs(). Also writes content.yml for the root config.
   * Covers any depth (e.g. project/issues/).
   */
  private async writeFolderConfigFiles(crawlerType: string): Promise<void> {
    const configs = this.themeEngine.getFolderConfigs(crawlerType);

    // Use listDirs to cover empty directories too (file-based listing misses them)
    const allDirs = this.storage.listDirs
      ? await this.storage.listDirs(this.markdownBasePath)
      : [];

    for (const dirPath of allDirs) {
      const folderName = dirPath.split("/").pop()!;
      if (!(folderName in configs)) continue;
      const ymlPath = `${dirPath}/${folderName}.yml`;
      await this.storage.write(ymlPath, serializeFolderConfig(configs[folderName]));
    }

    // Root content.yml is written only by prepare (which merges theme rootConfig
    // with collection-level hide patterns). The yml survives reconcile (skipped above).
  }

  private async deleteEntity(externalId: string): Promise<boolean> {
    const [existing] = this.db
      .select()
      .from(entities)
      .where(eq(entities.externalId, externalId))
      .all();

    if (!existing) return false;

    // Delete markdown file
    const markdownPath = existing.folder != null && existing.slug != null
      ? (existing.folder ? `${existing.folder}/${existing.slug}.md` : `${existing.slug}.md`)
      : null;
    if (markdownPath) {
      try {
        await this.storage.delete(this.toStoragePath(markdownPath));
      } catch {
        // File may already be gone
      }
    }

    // Remove this entity's externalId from all other entities' inLinks (in data)
    if (existing.externalId) {
      const allWithData = this.db
        .select({ id: entities.id, data: entities.data })
        .from(entities)
        .all();
      for (const row of allWithData) {
        const rowData = (row.data as EntityData) ?? { source: {} };
        const inLinks: string[] = rowData.in_links ?? [];
        if (inLinks.includes(existing.externalId)) {
          this.db
            .update(entities)
            .set({ data: { ...rowData, in_links: inLinks.filter((l) => l !== existing.externalId) } })
            .where(eq(entities.id, row.id))
            .run();
        }
      }
    }

    this.db.delete(entities).where(eq(entities.id, existing.id)).run();

    // Remove from search index
    this.searchIndexer.removeIndex(existing.id);

    return true;
  }
}
