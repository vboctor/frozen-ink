export interface Collection {
  name: string;
  connectorType: string;
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
