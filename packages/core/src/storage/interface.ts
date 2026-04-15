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
  /** List all subdirectories (recursively) under the given prefix. Paths are relative to the storage root. */
  listDirs?(prefix: string): Promise<string[]>;
  /** Returns file metadata, or null if the file does not exist. */
  stat(path: string): Promise<FileStat | null>;
  /** Set the modification time of a file (milliseconds since epoch). No-op if file doesn't exist. */
  utimes?(path: string, mtimeMs: number): Promise<void>;
}
