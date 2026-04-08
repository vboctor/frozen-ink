import { isBun } from "./runtime";

/**
 * Open a SQLite database in a runtime-agnostic way.
 * Under Bun: uses bun:sqlite.
 * Under Node.js/Electron: uses better-sqlite3.
 *
 * Returns a raw database handle whose API matches bun:sqlite's Database
 * (exec, prepare, close).
 */
export function openDatabase(dbPath: string): any {
  if (isBun) {
    const { Database } = require("bun:sqlite");
    return new Database(dbPath);
  }
  // Node.js / Electron — better-sqlite3
  const BetterSqlite3 = require("better-sqlite3");
  return new BetterSqlite3(dbPath);
}

/**
 * Create a drizzle ORM client in a runtime-agnostic way.
 * Under Bun: uses drizzle-orm/bun-sqlite.
 * Under Node.js/Electron: uses drizzle-orm/better-sqlite3.
 */
export async function createDrizzleClient(sqlite: any, schema: any) {
  if (isBun) {
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    return drizzle(sqlite, { schema });
  }
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  return drizzle(sqlite, { schema });
}
