export interface FileStat {
  /** Last modification time in milliseconds since epoch. */
  mtimeMs: number;
  /** File size in bytes. */
  size: number;
}

export interface StorageBackend {
  write(path: string, content: string | Buffer): Promise<void>;
  read(path: string): Promise<string>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  /** Returns file metadata, or null if the file does not exist. */
  stat(path: string): Promise<FileStat | null>;
}
