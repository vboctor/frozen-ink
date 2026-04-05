export interface ObsidianConfig {
  vaultPath: string;
  excludePatterns?: string[];
}

export interface ObsidianCredentials {
  vaultPath: string;
}

export interface VaultFile {
  relativePath: string;
  absolutePath: string;
  mtime: number;
  size: number;
}
