import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { randomBytes } from "crypto";
import { z } from "zod";
import yaml from "js-yaml";
import { getFrozenInkHome } from "./loader";

// --- Zod Schemas ---

const assetsConfigSchema = z.object({
  /** Allowed file extensions (with dot). Defaults to common image formats. */
  extensions: z.array(z.string()).optional(),
  /** Maximum file size in KB. Defaults to 10240 (10 MB). */
  maxSize: z.number().optional(),
}).optional();

const collectionEntrySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  mcpToolDescription: z.string().optional(),
  crawler: z.string(),
  enabled: z.boolean().optional().default(true),
  /** Crawler schema version the collection was last synced with. Defaults to "1.0". */
  version: z.string().optional().default("1.0"),
  syncInterval: z.number().optional(),
  config: z.record(z.unknown()).default({}),
  credentials: z.record(z.unknown()).default({}),
  assets: assetsConfigSchema,
  /**
   * Glob patterns matching filenames to hide from the collection root.
   * These are merged with the theme's rootConfig() defaults during prepare.
   * Example: ["draft.md", "*.wip"]
   */
  hide: z.array(z.string()).optional(),
  // --- Sync state (written after each sync; replaces collection_state DB table) ---
  lastSyncAt: z.string().optional(),
  lastSyncStatus: z.string().optional(),
  lastSyncCreated: z.number().optional(),
  lastSyncUpdated: z.number().optional(),
  lastSyncDeleted: z.number().optional(),
  lastSyncErrors: z.unknown().array().optional(),
  // --- Publish state ---
  lastPublishedAt: z.string().optional(),
  // --- Incremental sync cursor (replaces sync_state DB table) ---
  syncCursor: z.unknown().optional(),
});

/** Site config schema — immutable settings stored in <name>.yml */
const siteConfigSchema = z.object({
  url: z.string(),
  mcpUrl: z.string(),
  toolDescription: z.string().optional(),
  collections: z.array(z.string()),
  database: z.object({
    type: z.string(),
    id: z.string(),
    name: z.string().optional(),
  }),
  bucket: z.object({
    type: z.string(),
    name: z.string(),
  }),
  password: z.object({
    protected: z.boolean(),
    hash: z.string().optional(),
  }).optional(),
});

/** Site state schema — mutable state stored in state.yml */
const siteStateSchema = z.object({
  publishedAt: z.string(),
});

const siteEntrySchema = z.object({
  url: z.string(),
  mcpUrl: z.string(),
  toolDescription: z.string().optional(),
  collections: z.array(z.string()),
  database: z.object({
    type: z.string(),
    id: z.string(),
    name: z.string().optional(),
  }),
  bucket: z.object({
    type: z.string(),
    name: z.string(),
  }),
  password: z.object({
    protected: z.boolean(),
    hash: z.string().optional(),
  }).optional(),
  publishedAt: z.string(),
});

// --- Types ---

export type CollectionEntry = z.infer<typeof collectionEntrySchema>;
export type CollectionEntryInput = z.input<typeof collectionEntrySchema>;
export type SiteEntry = z.infer<typeof siteEntrySchema>;

// --- Paths ---

function getCollectionsDir(): string {
  return join(getFrozenInkHome(), "collections");
}

function getCollectionConfigPath(name: string): string {
  return join(getCollectionsDir(), name, `${name}.yml`);
}

function getSitesDir(): string {
  return join(getFrozenInkHome(), "sites");
}

function getSiteConfigPath(name: string): string {
  return join(getSitesDir(), name, `${name}.yml`);
}

function getSiteStatePath(name: string): string {
  return join(getSitesDir(), name, "state.yml");
}

// --- Atomic YAML write ---

function atomicWriteYaml(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const content = yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false });
  const tmpPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

function readYaml<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return (yaml.load(raw) as T) ?? null;
}

// --- Initialization ---

/**
 * Ensure the Frozen Ink home directory is initialized.
 * Creates collections/ and sites/ directories if they don't exist.
 * Also runs legacy migrations. Safe to call multiple times.
 */
export function ensureInitialized(): void {
  const home = getFrozenInkHome();
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, "collections"), { recursive: true });
  mkdirSync(join(home, "sites"), { recursive: true });
  // Create default frozenink.yml if it doesn't exist (and no legacy config.json)
  const configPath = join(home, "frozenink.yml");
  const legacyConfigPath = join(home, "config.json");
  if (!existsSync(configPath) && !existsSync(legacyConfigPath)) {
    atomicWriteYaml(configPath, { sync: { interval: 900 }, ui: { port: 3000 } });
  }
}

export function contextExists(): boolean {
  const home = getFrozenInkHome();
  return existsSync(join(home, "collections"));
}

// --- Collection CRUD ---

export function getCollection(name: string): (CollectionEntry & { name: string }) | null {
  const configPath = getCollectionConfigPath(name);
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed) return null;
    const entry = collectionEntrySchema.parse(parsed);
    return { ...entry, name };
  } catch {
    return null;
  }
}

export function listCollections(): Array<CollectionEntry & { name: string }> {
  const collectionsDir = getCollectionsDir();
  if (!existsSync(collectionsDir)) return [];

  const results: Array<CollectionEntry & { name: string }> = [];
  try {
    const entries = readdirSync(collectionsDir);
    for (const name of entries) {
      const dirPath = join(collectionsDir, name);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
      } catch { continue; }

      const configPath = join(dirPath, `${name}.yml`);
      if (!existsSync(configPath)) continue;

      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = yaml.load(raw) as Record<string, unknown> | null;
        if (!parsed) continue;
        const entry = collectionEntrySchema.parse(parsed);
        results.push({ ...entry, name });
      } catch { /* skip invalid entries */ }
    }
  } catch { /* ignore */ }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCollectionDbPath(name: string): string {
  const home = getFrozenInkHome();
  return join(home, "collections", name, "db", "data.db");
}

export function addCollection(name: string, entry: CollectionEntryInput): void {
  const parsed = collectionEntrySchema.parse(entry);
  const colDir = join(getCollectionsDir(), name);
  mkdirSync(colDir, { recursive: true });
  atomicWriteYaml(getCollectionConfigPath(name), parsed);
}

export function removeCollection(name: string): void {
  // Only removes the config file; the caller is responsible for deleting the directory.
  const configPath = getCollectionConfigPath(name);
  try { unlinkSync(configPath); } catch { /* ignore */ }
}

export function updateCollection(name: string, updates: Partial<CollectionEntry>): void {
  const existing = getCollection(name);
  if (!existing) return;
  const { name: _name, ...entry } = existing;
  const updated = { ...entry, ...updates };
  atomicWriteYaml(getCollectionConfigPath(name), updated);
}

export function renameCollection(oldName: string, newName: string): void {
  const existing = getCollection(oldName);
  if (!existing) return;
  const { name: _name, ...entry } = existing;
  // Write new config, remove old config
  const newDir = join(getCollectionsDir(), newName);
  mkdirSync(newDir, { recursive: true });
  atomicWriteYaml(getCollectionConfigPath(newName), entry);
  try { unlinkSync(getCollectionConfigPath(oldName)); } catch { /* ignore */ }
}

// --- Site CRUD (sites/<name>/) ---

export function addSite(name: string, entry: SiteEntry): void {
  const { publishedAt, ...config } = entry;
  const siteDir = join(getSitesDir(), name);
  mkdirSync(siteDir, { recursive: true });
  atomicWriteYaml(getSiteConfigPath(name), config);
  atomicWriteYaml(getSiteStatePath(name), { publishedAt });
}

export function removeSite(name: string): void {
  const siteDir = join(getSitesDir(), name);
  if (existsSync(siteDir)) {
    const { rmSync } = require("fs");
    rmSync(siteDir, { recursive: true, force: true });
  }
}

export function getSite(nameOrUrl: string): (SiteEntry & { name: string }) | null {
  // Try by name first
  const configPath = getSiteConfigPath(nameOrUrl);
  if (existsSync(configPath)) {
    try {
      const configRaw = readFileSync(configPath, "utf-8");
      const config = yaml.load(configRaw) as Record<string, unknown> | null;
      if (!config) return null;
      const stateRaw = readYaml<Record<string, unknown>>(getSiteStatePath(nameOrUrl));
      const publishedAt = (stateRaw?.publishedAt as string) ?? new Date().toISOString();
      const parsed = siteEntrySchema.parse({ ...config, publishedAt });
      return { ...parsed, name: nameOrUrl };
    } catch { return null; }
  }
  // Try by URL
  for (const site of listSites()) {
    if (site.url === nameOrUrl || site.mcpUrl === nameOrUrl) {
      return site;
    }
  }
  return null;
}

export function listSites(): Array<SiteEntry & { name: string }> {
  const sitesDir = getSitesDir();
  if (!existsSync(sitesDir)) return [];

  const results: Array<SiteEntry & { name: string }> = [];
  try {
    for (const name of readdirSync(sitesDir)) {
      const dirPath = join(sitesDir, name);
      try { if (!statSync(dirPath).isDirectory()) continue; } catch { continue; }
      const configPath = join(dirPath, `${name}.yml`);
      if (!existsSync(configPath)) continue;
      try {
        const configRaw = readFileSync(configPath, "utf-8");
        const config = yaml.load(configRaw) as Record<string, unknown> | null;
        if (!config) continue;
        const stateRaw = readYaml<Record<string, unknown>>(join(dirPath, "state.yml"));
        const publishedAt = (stateRaw?.publishedAt as string) ?? new Date().toISOString();
        const parsed = siteEntrySchema.parse({ ...config, publishedAt });
        results.push({ ...parsed, name });
      } catch { /* skip invalid */ }
    }
  } catch { /* ignore */ }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function updateSiteState(name: string, state: { publishedAt: string }): void {
  atomicWriteYaml(getSiteStatePath(name), state);
}

