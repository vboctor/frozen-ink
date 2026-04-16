import { openDatabase } from "../compat/sqlite";

export class MetadataStore {
  private sqlite: any;

  constructor(dbPath: string) {
    this.sqlite = openDatabase(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  get(key: string): string;
  get(key: string, defaultValue: string): string;
  get(key: string, defaultValue?: string): string {
    const row = this.sqlite
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (row != null) {
      return row.value;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Metadata key not found: "${key}"`);
  }

  set(key: string, value: string): void {
    this.sqlite
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  close(): void {
    this.sqlite.close();
  }
}
