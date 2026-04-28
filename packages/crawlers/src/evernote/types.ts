import type { SyncCursor } from "@frozenink/core";

export interface EvernoteConfig {
  /**
   * Optional override for the conduit-storage directory. Default is the
   * auto-detected macOS path under
   * `~/Library/Containers/com.evernote.Evernote/Data/Library/Application Support/Evernote/conduit-storage/`.
   */
  conduitStoragePath?: string;
  /** Optional notebook allowlist (names or GUIDs). Empty/undefined = all. */
  notebooks?: string[];
  /**
   * Default true. Snapshot DB+WAL+SHM into a temp dir before reading so
   * Evernote can stay running during sync.
   */
  snapshot?: boolean;
}

export interface EvernoteCredentials {
  /** Local crawler — no secrets. Kept for symmetry with the Crawler interface. */
  conduitStoragePath?: string;
}

export interface EvernoteSyncCursor extends SyncCursor {
  /** Per syncContext (notebook scope), the highest USN already imported. */
  highWaterByContext?: Record<string, number>;
  /**
   * Snapshot of (nodeId → version) pairs from the previous sync — used to
   * detect deletions: any id present before but missing now is a tombstone.
   */
  knownNodes?: Record<string, number>;
}

/** Internal: a parsed Evernote note row (after JSON-decoding `NodeFields`). */
export interface EvernoteNoteRow {
  guid: string;
  title: string;
  notebookId?: string;
  contentHash?: string;
  active: boolean;
  created?: number;
  updated?: number;
  updateSequenceNum: number;
  /** Raw `evernoteTags` field — list of tag GUIDs that resolve via tagMap. */
  tagGuids?: string[];
  /** XML/HTML 'recognition' blob from per-resource fields, if any. */
  recognitionByResourceHash?: Record<string, string>;
  /** ENML body if Evernote stored it directly inside the note's NodeFields. */
  enml?: string;
}

export interface EvernoteNotebookRow {
  guid: string;
  name: string;
  updateSequenceNum: number;
}

export interface EvernoteTagRow {
  guid: string;
  name: string;
}

export interface EvernoteResourceRow {
  guid: string;
  noteGuid: string;
  hash: string;
  mime?: string;
  filename?: string;
  size?: number;
  recognition?: string;
}
