export interface SyncCursor {
  [key: string]: unknown;
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
}
