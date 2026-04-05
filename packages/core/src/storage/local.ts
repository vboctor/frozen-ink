import { mkdir, writeFile, readFile, unlink, access, readdir, stat } from "fs/promises";
import { dirname, join, relative } from "path";
import type { StorageBackend, FileStat } from "./interface";

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

  async list(prefix: string): Promise<string[]> {
    const dir = join(this.basePath, prefix);
    const base = this.basePath;
    const result: string[] = [];

    async function walk(dirPath: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const entryPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else if (entry.isFile()) {
          result.push(relative(base, entryPath));
        }
      }
    }

    await walk(dir);
    return result;
  }

  async stat(path: string): Promise<FileStat | null> {
    const fullPath = join(this.basePath, path);
    try {
      const s = await stat(fullPath);
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }
}
