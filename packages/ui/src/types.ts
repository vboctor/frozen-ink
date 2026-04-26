export interface PublishState {
  url: string;
  mcpUrl: string;
  protected?: boolean;
  publishedAt: string;
}

export type McpTransport = "stdio" | "http";

export interface McpToolLink {
  collection: string;
  connectionName: string;
  linked: boolean;
  description?: string;
}

export interface McpLinkStatus {
  tool: string;
  displayName: string;
  available: boolean;
  reason?: string;
  supportsStdio: boolean;
  supportsHttp: boolean;
  links: McpToolLink[];
}

export interface McpAddRequest {
  tool: string;
  collections: string[];
  transport: McpTransport;
  password?: string;
  description?: string;
}

export interface Collection {
  name: string;
  title: string;
  description?: string;
  crawlerType: string;
  enabled: boolean;
  syncInterval: number;
  createdAt: string;
  updatedAt: string;
  publish?: PublishState;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  /** Human-readable entity title; falls back to name (without .md) if absent */
  title?: string;
  /** Total number of entity files (recursive) in this directory; only present on directory nodes. */
  count?: number;
  /** Whether this directory starts expanded (undefined = true). */
  expanded?: boolean;
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
  diskSizeBytes: number;
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

export interface SyncJob {
  collectionName: string;
  active: boolean;
  status: string;
  created: number;
  updated: number;
  deleted: number;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  full: boolean;
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
  startedAt: number | null;
}

export type UIMode = "browse" | "manage";

export interface CollectionConfig {
  name: string;
  title?: string;
  crawler: string;
  enabled?: boolean;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface FrozenInkConfig {
  sync: { interval: number };
  ui: { port: number };
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
