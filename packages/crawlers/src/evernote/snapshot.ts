import { mkdtempSync, copyFileSync, existsSync, rmSync, readdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface ConduitSnapshot {
  /** Absolute path to the copied DB file inside the temp directory. */
  dbPath: string;
  /** Removes the temp directory and all snapshot files. */
  cleanup: () => void;
}

/**
 * Find the active RemoteGraph SQLite database under a conduit-storage tree.
 *
 * Evernote v10 nests the per-account databases one level deep under a
 * URL-encoded host directory (e.g.
 * `conduit-storage/https%3A%2F%2Fwww.evernote.com/UDB-User1234+RemoteGraph.sql`).
 * Older builds wrote them directly inside `conduit-storage/`. We accept both.
 * The matching rule: filename ends with `+RemoteGraph.sql` (the trailing
 * literal excludes `+BackupRemoteGraph.sql` and `+LocalStorage.sql`). When
 * multiple candidates exist (e.g. several accounts) we return the most
 * recently modified one.
 */
export function findRemoteGraphDb(conduitStorageDir: string): string | null {
  if (!existsSync(conduitStorageDir)) return null;
  const candidates: { path: string; mtime: number }[] = [];
  walk(conduitStorageDir, 2, (path) => {
    const name = path.split("/").pop() ?? "";
    if (!name.endsWith("+RemoteGraph.sql")) return;
    try {
      candidates.push({ path, mtime: statSync(path).mtimeMs });
    } catch {
      // skip unreadable
    }
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

function walk(dir: string, maxDepth: number, visit: (path: string) => void): void {
  if (maxDepth < 0) return;
  let entries: import("fs").Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import("fs").Dirent[];
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, String(e.name));
    if (e.isDirectory()) walk(full, maxDepth - 1, visit);
    else if (e.isFile()) visit(full);
  }
}

/**
 * Returns true when the DB has uncheckpointed WAL pages — i.e. Evernote
 * (or some other writer) currently has the database open with pending
 * writes. When this returns false the DB file on disk is internally
 * consistent and can be opened read-only without the snapshot dance.
 */
export function isWalDirty(dbPath: string): boolean {
  const wal = `${dbPath}-wal`;
  if (!existsSync(wal)) return false;
  try {
    return statSync(wal).size > 0;
  } catch {
    // If we can't stat the WAL, assume the worst and snapshot.
    return true;
  }
}

/**
 * Copy the conduit-storage SQLite DB (plus its `-wal` and `-shm` siblings,
 * if present) into a fresh temp directory so that we can read a stable
 * snapshot even while Evernote is running. Returns the new DB path and a
 * cleanup function that removes the temp directory.
 */
export function copyConduitStorage(srcDir: string): ConduitSnapshot {
  const dbSrc = findRemoteGraphDb(srcDir);
  if (!dbSrc) {
    throw new Error(
      `No Evernote RemoteGraph DB found in ${srcDir}. Is Evernote v10 installed and signed in?`,
    );
  }

  const tmp = mkdtempSync(join(tmpdir(), "frozenink-evernote-"));
  const baseName = dbSrc.split("/").pop()!;
  const dbDst = join(tmp, baseName);

  // Copy DB + sidecars together so the snapshot is internally consistent
  // (WAL pages may be needed to reconstruct the latest state).
  copyFileSync(dbSrc, dbDst);
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${dbSrc}${suffix}`;
    if (existsSync(side)) {
      copyFileSync(side, `${dbDst}${suffix}`);
    }
  }

  return {
    dbPath: dbDst,
    cleanup: () => {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}
