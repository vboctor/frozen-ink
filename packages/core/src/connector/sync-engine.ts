import { eq, and } from "drizzle-orm";
import { getCollectionDb } from "../db/client";
import {
  entities,
  entityTags,
  attachments,
  syncState,
  syncRuns,
  entityRelations,
} from "../db/collection-schema";
import type { Connector, ConnectorEntityData, SyncCursor } from "./interface";
import type { ThemeEngine } from "../theme/engine";
import type { StorageBackend } from "../storage/interface";

function computeHash(data: Record<string, unknown>): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(data));
  return hasher.digest("hex");
}

export interface SyncEngineOptions {
  connector: Connector;
  dbPath: string;
  collectionName: string;
  themeEngine: ThemeEngine;
  storage: StorageBackend;
  markdownBasePath: string;
}

export class SyncEngine {
  private connector: Connector;
  private db: ReturnType<typeof getCollectionDb>;
  private collectionName: string;
  private themeEngine: ThemeEngine;
  private storage: StorageBackend;
  private markdownBasePath: string;

  constructor(options: SyncEngineOptions) {
    this.connector = options.connector;
    this.db = getCollectionDb(options.dbPath);
    this.collectionName = options.collectionName;
    this.themeEngine = options.themeEngine;
    this.storage = options.storage;
    this.markdownBasePath = options.markdownBasePath;
  }

  async run(): Promise<void> {
    const connectorType = this.connector.metadata.type;
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
        .where(eq(syncState.connectorType, connectorType))
        .all();
      let cursor: SyncCursor | null = (stateRow?.cursor as SyncCursor) ?? null;

      // Sync loop
      let hasMore = true;
      while (hasMore) {
        const result = await this.connector.sync(cursor);

        // Process entities
        for (const entityData of result.entities) {
          const counts = await this.upsertEntity(entityData, connectorType);
          created += counts.created;
          updated += counts.updated;
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
            .values({ connectorType, cursor: cursor as Record<string, unknown> })
            .run();
        }
      }

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
    entityData: ConnectorEntityData,
    connectorType: string,
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
      const markdown = this.renderMarkdown(entityData, connectorType);
      const filePath = this.getMarkdownPath(entityData, connectorType);
      await this.storage.write(filePath, markdown);

      // Update entity
      this.db
        .update(entities)
        .set({
          title: entityData.title,
          entityType: entityData.entityType,
          data: entityData.data,
          contentHash,
          markdownPath: filePath,
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

      return { created: 0, updated: 1 };
    }

    // New entity — render markdown
    const markdown = this.renderMarkdown(entityData, connectorType);
    const filePath = this.getMarkdownPath(entityData, connectorType);
    await this.storage.write(filePath, markdown);

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

    return { created: 1, updated: 0 };
  }

  private async syncAttachments(
    entityId: number,
    entityData: ConnectorEntityData,
  ): Promise<void> {
    // Remove old attachments
    this.db.delete(attachments).where(eq(attachments.entityId, entityId)).run();

    if (!entityData.attachments?.length) return;

    for (const att of entityData.attachments) {
      const storagePath = `attachments/${entityData.externalId}/${att.filename}`;
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

  private renderMarkdown(
    entityData: ConnectorEntityData,
    connectorType: string,
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
      connectorType,
    });
  }

  private getMarkdownPath(
    entityData: ConnectorEntityData,
    connectorType: string,
  ): string {
    if (this.themeEngine.has(connectorType)) {
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
        connectorType,
      });
      return `${this.markdownBasePath}/${themePath}`;
    }
    return `${this.markdownBasePath}/${entityData.entityType}/${entityData.externalId}.md`;
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
    this.db
      .delete(entityRelations)
      .where(eq(entityRelations.sourceEntityId, existing.id))
      .run();
    this.db
      .delete(entityRelations)
      .where(eq(entityRelations.targetEntityId, existing.id))
      .run();
    this.db.delete(entities).where(eq(entities.id, existing.id)).run();

    return true;
  }
}
