import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getFrozenInkHome } from "./loader";
import { getCollection, updateCollection } from "./context";

function getDirectorySizeBytes(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySizeBytes(full);
      } else {
        try { total += statSync(full).size; } catch {}
      }
    }
  } catch {}
  return total;
}

function collectionDir(name: string): string {
  return join(getFrozenInkHome(), "collections", name);
}

function bytesToKb(bytes: number): number {
  return Math.round(bytes / 1024);
}

/** Read the cached disk size (KB) from the collection's YAML; null if not cached. */
export function readCachedDiskSizeKb(name: string): number | null {
  const col = getCollection(name);
  if (!col) return null;
  return typeof col.size === "number" ? col.size : null;
}

/**
 * Persist the cached size (KB) to the collection YAML. updateCollection does
 * read-modify-write so we don't stomp concurrent edits to other fields.
 */
function writeCachedDiskSizeKb(name: string, sizeKb: number): void {
  try {
    updateCollection(name, { size: sizeKb });
  } catch {
    // Cache write is best-effort.
  }
}

const refreshLocks = new Map<string, Promise<number>>();

/**
 * Recompute the directory size and persist it (in KB) to the YAML cache.
 * Returns size in bytes. Serialized per-collection via an in-process mutex
 * so concurrent refreshes don't race.
 */
export function refreshDiskSizeCache(name: string): Promise<number> {
  const inflight = refreshLocks.get(name);
  if (inflight) return inflight;
  const promise = (async () => {
    const bytes = getDirectorySizeBytes(collectionDir(name));
    writeCachedDiskSizeKb(name, bytesToKb(bytes));
    return bytes;
  })();
  refreshLocks.set(name, promise);
  promise.finally(() => refreshLocks.delete(name)).catch(() => {});
  return promise;
}

/**
 * Return the cached size (in bytes) if present; otherwise compute it now,
 * persist it as KB, and return bytes. Cold-path compute is paid once.
 */
export function getOrComputeDiskSize(name: string): number {
  const cachedKb = readCachedDiskSizeKb(name);
  if (cachedKb != null) return cachedKb * 1024;
  const bytes = getDirectorySizeBytes(collectionDir(name));
  writeCachedDiskSizeKb(name, bytesToKb(bytes));
  return bytes;
}
