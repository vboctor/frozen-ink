import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from "fs";
import { join, dirname } from "path";
import { z } from "zod";
import yaml from "js-yaml";
import { getFrozenInkHome } from "./loader";
import { atomicWriteYaml, readYaml } from "./yaml-utils";

// --- Zod Schemas ---

const assetsConfigSchema = z.object({
  extensions: z.array(z.string()).optional(),
  maxSize: z.number().optional(),
}).optional();

const publishStateSchema = z.object({
  url: z.string(),
  mcpUrl: z.string(),
  password: z.object({
    protected: z.boolean(),
    hash: z.string().optional(),
  }).optional(),
  publishedAt: z.string(),
  dbDigest: z.string().optional(),
});

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
  credentials: z.union([z.string(), z.record(z.unknown())]).default({}),
  assets: assetsConfigSchema,
  /**
   * Glob patterns matching filenames to hide from the collection root.
   * These are merged with the theme's rootConfig() defaults during prepare.
   * Example: ["draft.md", "*.wip"]
   */
  hide: z.array(z.string()).optional(),
  publish: publishStateSchema.optional(),
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

const legacyDeploymentEntrySchema = z.object({
  url: z.string(),
  mcpUrl: z.string(),
  toolDescription: z.string().optional(),
  collections: z.array(z.string()),
  d1DatabaseId: z.string(),
  d1DatabaseName: z.string().optional(),
  r2BucketName: z.string(),
  cfAccountId: z.string().optional(),
  passwordProtected: z.boolean(),
  passwordHash: z.string().optional(),
  publishedAt: z.string(),
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

const frozenInkSchema = z.object({
  collections: z.record(collectionEntrySchema).default({}),
  deployments: z.record(legacyDeploymentEntrySchema).default({}),
});

// --- Types ---

export type CollectionEntry = z.infer<typeof collectionEntrySchema>;
export type CollectionEntryInput = z.input<typeof collectionEntrySchema>;
export type PublishState = z.infer<typeof publishStateSchema>;
export type FrozenInkYaml = z.infer<typeof frozenInkSchema>;
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

function getLegacyPublishPath(): string {
  return join(getFrozenInkHome(), "publish.yml");
}

function getLegacyContextPath(): string {
  return join(getFrozenInkHome(), "context.yml");
}

// --- Migration ---

export function migrateFromLegacyContext(): void {
  const legacyPath = getLegacyContextPath();
  if (existsSync(legacyPath)) {
    const raw = readFileSync(legacyPath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (parsed) {
      const ctx = frozenInkSchema.parse(parsed);

      for (const [name, entry] of Object.entries(ctx.collections)) {
        const configPath = getCollectionConfigPath(name);
        const colDir = dirname(configPath);
        if (!existsSync(colDir)) {
          mkdirSync(colDir, { recursive: true });
        }
        const legacyConfigPath = join(colDir, ".config");
        if (existsSync(legacyConfigPath) && !existsSync(configPath)) {
          renameSync(legacyConfigPath, configPath);
        } else if (!existsSync(configPath)) {
          atomicWriteYaml(configPath, entry);
        }
      }

      for (const [_name, dep] of Object.entries(ctx.deployments)) {
        if (dep.collections.length > 0) {
          const colName = dep.collections[0];
          const col = getCollection(colName);
          if (col && !col.publish) {
            updateCollectionPublishState(colName, {
              url: dep.url,
              mcpUrl: dep.mcpUrl,
              password: { protected: dep.passwordProtected, hash: dep.passwordHash },
              publishedAt: dep.publishedAt,
            });
          }
        }
      }

      try { unlinkSync(legacyPath); } catch { /* ignore */ }
    }
  }

  const collectionsDir = getCollectionsDir();
  if (existsSync(collectionsDir)) {
    for (const name of readdirSync(collectionsDir)) {
      const colDir = join(collectionsDir, name);
      try { if (!statSync(colDir).isDirectory()) continue; } catch { continue; }
      const legacyConfigPath = join(colDir, ".config");
      const newConfigPath = join(colDir, `${name}.yml`);
      if (existsSync(legacyConfigPath) && !existsSync(newConfigPath)) {
        renameSync(legacyConfigPath, newConfigPath);
      }
    }
  }

  const home = getFrozenInkHome();
  for (const f of ["master.db", "master.db-wal", "master.db-shm"]) {
    try { unlinkSync(join(home, f)); } catch { /* ignore */ }
  }

  migrateLegacyPublishYml();
  migrateLegacySites();
}

export function migrateLegacyPublishYml(): void {
  const publishPath = getLegacyPublishPath();
  if (!existsSync(publishPath)) return;

  const data = readYaml<Record<string, unknown>>(publishPath);
  if (!data) return;

  for (const [_name, raw] of Object.entries(data)) {
    try {
      const dep = legacyDeploymentEntrySchema.parse(raw);
      if (dep.collections.length > 0) {
        const colName = dep.collections[0];
        const col = getCollection(colName);
        if (col && !col.publish) {
          updateCollectionPublishState(colName, {
            url: dep.url,
            mcpUrl: dep.mcpUrl,
            password: { protected: dep.passwordProtected, hash: dep.passwordHash },
            publishedAt: dep.publishedAt,
          });
        }
      }
    } catch { /* skip invalid entries */ }
  }

  try { unlinkSync(publishPath); } catch { /* ignore */ }
}

export function migrateLegacySites(): void {
  const sitesDir = getSitesDir();
  if (!existsSync(sitesDir)) return;

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
        const collections = (config.collections as string[]) ?? [];
        if (collections.length > 0) {
          const colName = collections[0];
          const col = getCollection(colName);
          if (col && !col.publish) {
            updateCollectionPublishState(colName, {
              url: config.url as string,
              mcpUrl: config.mcpUrl as string,
              password: config.password as { protected: boolean; hash?: string } | undefined,
              publishedAt,
            });
          }
        }
      } catch { /* skip invalid */ }
    }
  } catch { /* ignore */ }

  try {
    const { rmSync } = require("fs");
    rmSync(sitesDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// --- Initialization ---

export function ensureInitialized(): void {
  const home = getFrozenInkHome();
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, "collections"), { recursive: true });
  const configPath = join(home, "frozenink.yml");
  const legacyConfigPath = join(home, "config.json");
  if (!existsSync(configPath) && !existsSync(legacyConfigPath)) {
    atomicWriteYaml(configPath, { sync: { interval: 900 }, ui: { port: 3000 } });
  }

  // Create sample credentials.yml if it doesn't exist
  const credentialsPath = join(home, "credentials.yml");
  if (!existsSync(credentialsPath)) {
    writeFileSync(credentialsPath, SAMPLE_CREDENTIALS_YML, "utf-8");
  }
}

const SAMPLE_CREDENTIALS_YML = `\
# Frozen Ink — Named Credentials
#
# Define reusable credential sets here. Collections can reference them by name
# instead of storing secrets inline, keeping your collection folders safe to
# share with AI tools.
#
# Usage in a collection YAML:
#   credentials: my-github        # references the "my-github" entry below
#
# Format:
#   <name>:
#     <key>: <value>
#
# Examples (uncomment and fill in your values):
#
# my-github:
#   token: ghp_your_token_here
#
# work-mantishub:
#   token: your_api_token_here
`;

export function contextExists(): boolean {
  const home = getFrozenInkHome();
  return existsSync(join(home, "collections"));
}

// --- Legacy compat ---

export function loadContext(): FrozenInkYaml {
  return {
    collections: Object.fromEntries(
      listCollections().map((c) => {
        const { name, ...entry } = c;
        return [name, entry];
      }),
    ),
    deployments: {},
  };
}

export function saveContext(_ctx: FrozenInkYaml): void {}

// --- Collection Publish State ---

export function getCollectionPublishState(name: string): PublishState | null {
  const col = getCollection(name);
  return col?.publish ?? null;
}

export function updateCollectionPublishState(name: string, state: PublishState): void {
  const existing = getCollection(name);
  if (!existing) return;
  const { name: _name, ...entry } = existing;
  const updated = { ...entry, publish: state };
  atomicWriteYaml(getCollectionConfigPath(name), updated);
}

export function clearCollectionPublishState(name: string): void {
  const existing = getCollection(name);
  if (!existing) return;
  const { name: _name, publish: _publish, ...rest } = existing;
  atomicWriteYaml(getCollectionConfigPath(name), rest);
}

export function listPublishedCollections(): Array<CollectionEntry & { name: string }> {
  return listCollections().filter((c) => !!c.publish);
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
