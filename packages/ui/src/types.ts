export interface Collection {
  name: string;
  title: string;
  crawlerType: string;
  enabled: boolean;
  syncInterval: number;
  createdAt: string;
  updatedAt: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export interface SearchResult {
  collection: string;
  entityId: number;
  externalId: string;
  entityType: string;
  title: string;
  markdownPath: string | null;
  rank: number;
}

// --- Management types ---

export interface AppInfo {
  mode: "desktop" | "published" | "local";
  version: string;
  workspacePath: string;
}

export interface CollectionStatus {
  entityCount: number;
  lastSyncRun: SyncRun | null;
}

export interface SyncRun {
  id: number;
  status: string;
  syncType: "full" | "incremental";
  entitiesCreated: number;
  entitiesUpdated: number;
  entitiesDeleted: number;
  errors: unknown;
  startedAt: string;
  completedAt: string | null;
}

export interface SyncProgress {
  active: boolean;
  collectionName: string | null;
  status: string;
  created: number;
  updated: number;
  deleted: number;
  error: string | null;
}

export interface Deployment {
  name: string;
  url: string;
  mcpUrl: string;
  collections: string[];
  d1DatabaseId: string;
  r2BucketName: string;
  passwordProtected: boolean;
  publishedAt: string;
}

export interface ExportRequest {
  collections: string[];
  outputDir: string;
  format: "markdown" | "html";
}

export interface ExportProgress {
  active: boolean;
  step: string;
  current: number;
  total: number;
  error: string | null;
}

export interface PublishProgress {
  active: boolean;
  step: string;
  detail: string;
  error: string | null;
}

export type UIMode = "browse" | "manage";

export interface PublishPreset {
  name: string;
  workerName: string;
  collections: string[];
  password: string;
}

export interface CollectionConfig {
  name: string;
  title?: string;
  crawler: string;
  enabled?: boolean;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface FrozenInkConfig {
  sync: { interval: number; concurrency: number; retries: number };
  logging: { level: string };
  [key: string]: unknown;
}

/**
 * Parse a database timestamp (stored as UTC without 'Z' suffix, e.g. "2026-04-07 20:38:12")
 * and format it in the user's local timezone.
 */
export function formatTimestamp(ts: string): string {
  // DB timestamps are UTC but stored without 'Z' — append it so Date parses as UTC
  const normalized = ts.includes("T") || ts.includes("Z") ? ts : ts.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleString();
}

/** Same as formatTimestamp but date-only. */
export function formatDate(ts: string): string {
  const normalized = ts.includes("T") || ts.includes("Z") ? ts : ts.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleDateString();
}
