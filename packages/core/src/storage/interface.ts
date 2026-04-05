export interface StorageBackend {
  write(path: string, content: string | Buffer): Promise<void>;
  read(path: string): Promise<string>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
