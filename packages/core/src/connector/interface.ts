export interface SyncCursor {
  [key: string]: unknown;
}

export interface ConnectorEntityData {
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
  }[];
  relations?: {
    targetExternalId: string;
    relationType: string;
  }[];
}

export interface SyncResult {
  entities: ConnectorEntityData[];
  nextCursor: SyncCursor | null;
  hasMore: boolean;
  deletedExternalIds: string[];
}

export interface ConnectorMetadata {
  type: string;
  displayName: string;
  description: string;
  configSchema: Record<string, unknown>;
  credentialFields: string[];
}

export interface Connector {
  metadata: ConnectorMetadata;
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
