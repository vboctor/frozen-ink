import { mkdir, writeFile, readFile, unlink, access } from "fs/promises";
import { dirname, join } from "path";
import type { StorageBackend } from "./interface";

export class LocalStorageBackend implements StorageBackend {
  constructor(private basePath: string) {}

  async write(path: string, content: string | Buffer): Promise<void> {
    const fullPath = join(this.basePath, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  async read(path: string): Promise<string> {
    const fullPath = join(this.basePath, path);
    return readFile(fullPath, "utf-8");
  }

  async delete(path: string): Promise<void> {
    const fullPath = join(this.basePath, path);
    await unlink(fullPath);
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = join(this.basePath, path);
    try {
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}
