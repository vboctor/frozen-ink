export interface SyncCursor {
  [key: string]: unknown;
}

export interface AssetFilter {
  /** Maximum allowed file size in bytes. */
  maxSizeBytes: number;
  /** Allowed file extensions (lowercase, with dot, e.g. ".png"). */
  allowedExtensions: Set<string>;
}

export interface CrawlerEntityData {
  externalId: string;
  entityType: string;
  title: string;
  data: Record<string, unknown>;
  contentHash?: string;
  url?: string;
  tags?: string[];
  attachments?: {
    filename: string;
    mimeType: string;
    content: Buffer | Uint8Array;
    storagePath?: string;
  }[];
  relations?: {
    targetExternalId: string;
    relationType: string;
  }[];
}

export interface SyncResult {
  entities: CrawlerEntityData[];
  nextCursor: SyncCursor | null;
  hasMore: boolean;
  deletedExternalIds: string[];
}

export interface CrawlerMetadata {
  type: string;
  displayName: string;
  description: string;
  configSchema: Record<string, unknown>;
  credentialFields: string[];
  /** Crawler schema version. Major bump = full re-sync required; minor bump = re-render markdown. Defaults to "1.0". */
  version?: string;
}

export interface Crawler {
  metadata: CrawlerMetadata;
  initialize(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Promise<void>;
  sync(cursor: SyncCursor | null): Promise<SyncResult>;
  validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<boolean>;
  dispose(): Promise<void>;
  /**
   * Optional: set the asset download filter before sync runs.
   * Crawlers that support it will skip downloading attachments that don't
   * match the filter, avoiding unnecessary network requests and errors.
   */
  setAssetFilter?(filter: AssetFilter): void;
  /**
   * Optional: set a progress callback that the crawler will invoke during
   * sync() with short human-readable messages about what it's doing
   * (e.g. "Scanning issues (page 3)", "Fetching 42 updated issues"). Used
   * by the UI/TUI to show what's happening under the hood.
   */
  setProgressCallback?(callback: (message: string) => void): void;
}
