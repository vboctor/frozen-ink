import { existsSync } from "fs";
import { openDatabase } from "../compat/sqlite";

/**
 * Snapshot of collection runtime state persisted in the `metadata` table.
 * Written by the sync engine on every run; read by UI/API surfaces.
 */
export interface SyncStateSnapshot {
  cursor?: unknown;
  lastAt?: string;
  lastStatus?: string;
  lastCreated?: number;
  lastUpdated?: number;
  lastDeleted?: number;
  lastErrors?: unknown[];
}

/**
 * Update shape for `setSyncState`. `cursor` and `lastErrors` accept `null`
 * to delete the key; unset fields are left as-is.
 */
export interface SyncStateUpdate {
  cursor?: unknown;
  lastAt?: string;
  lastStatus?: string;
  lastCreated?: number;
  lastUpdated?: number;
  lastDeleted?: number;
  lastErrors?: unknown[] | null;
}

/** Metadata key namespace. All keys are implicitly scoped to the collection. */
const K = {
  syncCursor: "sync.cursor",
  syncLastAt: "sync.last_at",
  syncLastStatus: "sync.last_status",
  syncLastCreated: "sync.last_created",
  syncLastUpdated: "sync.last_updated",
  syncLastDeleted: "sync.last_deleted",
  syncLastErrors: "sync.last_errors",
  title: "title",
  description: "description",
  version: "version",
} as const;

export class MetadataStore {
  private sqlite: any;

  constructor(dbPath: string) {
    this.sqlite = openDatabase(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  get(key: string): string;
  get(key: string, defaultValue: string): string;
  get(key: string, defaultValue?: string): string {
    const row = this.sqlite
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (row != null) {
      return row.value;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Metadata key not found: "${key}"`);
  }

  /** Return the value for `key`, or null if the key does not exist. */
  getOptional(key: string): string | null {
    const row = this.sqlite
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.sqlite
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  delete(key: string): void {
    this.sqlite.prepare("DELETE FROM metadata WHERE key = ?").run(key);
  }

  // --- Typed sync state accessors ---

  getSyncState(): SyncStateSnapshot {
    const snapshot: SyncStateSnapshot = {};

    const cursor = this.getOptional(K.syncCursor);
    if (cursor !== null) {
      try { snapshot.cursor = JSON.parse(cursor); } catch { /* ignore corrupt cursor */ }
    }

    const lastAt = this.getOptional(K.syncLastAt);
    if (lastAt !== null) snapshot.lastAt = lastAt;

    const lastStatus = this.getOptional(K.syncLastStatus);
    if (lastStatus !== null) snapshot.lastStatus = lastStatus;

    const lastCreated = this.getOptional(K.syncLastCreated);
    if (lastCreated !== null) snapshot.lastCreated = Number(lastCreated);

    const lastUpdated = this.getOptional(K.syncLastUpdated);
    if (lastUpdated !== null) snapshot.lastUpdated = Number(lastUpdated);

    const lastDeleted = this.getOptional(K.syncLastDeleted);
    if (lastDeleted !== null) snapshot.lastDeleted = Number(lastDeleted);

    const lastErrors = this.getOptional(K.syncLastErrors);
    if (lastErrors !== null) {
      try { snapshot.lastErrors = JSON.parse(lastErrors); } catch { /* ignore */ }
    }

    return snapshot;
  }

  setSyncState(updates: SyncStateUpdate): void {
    if ("cursor" in updates) {
      if (updates.cursor == null) this.delete(K.syncCursor);
      else this.set(K.syncCursor, JSON.stringify(updates.cursor));
    }
    if (updates.lastAt !== undefined) this.set(K.syncLastAt, updates.lastAt);
    if (updates.lastStatus !== undefined) this.set(K.syncLastStatus, updates.lastStatus);
    if (updates.lastCreated !== undefined) this.set(K.syncLastCreated, String(updates.lastCreated));
    if (updates.lastUpdated !== undefined) this.set(K.syncLastUpdated, String(updates.lastUpdated));
    if (updates.lastDeleted !== undefined) this.set(K.syncLastDeleted, String(updates.lastDeleted));
    if ("lastErrors" in updates) {
      if (updates.lastErrors == null || updates.lastErrors.length === 0) {
        this.delete(K.syncLastErrors);
      } else {
        this.set(K.syncLastErrors, JSON.stringify(updates.lastErrors));
      }
    }
  }

  /** Mirror of the collection's display title from the YAML config. */
  setCollectionTitle(title: string | null | undefined): void {
    if (title == null || title === "") this.delete(K.title);
    else this.set(K.title, title);
  }

  getCollectionTitle(): string | null {
    return this.getOptional(K.title);
  }

  /** Mirror of the collection's description from the YAML config. */
  setCollectionDescription(description: string | null | undefined): void {
    if (description == null || description === "") this.delete(K.description);
    else this.set(K.description, description);
  }

  getCollectionDescription(): string | null {
    return this.getOptional(K.description);
  }

  /** Mirror of the crawler schema version from the YAML config. */
  setCollectionVersion(version: string | null | undefined): void {
    if (version == null || version === "") this.delete(K.version);
    else this.set(K.version, version);
  }

  getCollectionVersion(): string | null {
    return this.getOptional(K.version);
  }

  close(): void {
    this.sqlite.close();
  }
}

/**
 * Read the sync state for a collection by DB path. Returns an empty snapshot
 * when the DB file does not yet exist (collection has never been synced).
 */
export function getCollectionSyncState(dbPath: string): SyncStateSnapshot {
  if (!existsSync(dbPath)) return {};
  const store = new MetadataStore(dbPath);
  try {
    return store.getSyncState();
  } finally {
    store.close();
  }
}

/** Apply a partial sync state update. Creates the DB file if needed. */
export function updateCollectionSyncState(
  dbPath: string,
  updates: SyncStateUpdate,
): void {
  const store = new MetadataStore(dbPath);
  try {
    store.setSyncState(updates);
  } finally {
    store.close();
  }
}

/** Write title + description + version mirror from YAML into the metadata table. */
export function writeCollectionConfigMirror(
  dbPath: string,
  config: { title?: string | null; description?: string | null; version?: string | null },
): void {
  const store = new MetadataStore(dbPath);
  try {
    store.setCollectionTitle(config.title ?? null);
    store.setCollectionDescription(config.description ?? null);
    store.setCollectionVersion(config.version ?? null);
  } finally {
    store.close();
  }
}
