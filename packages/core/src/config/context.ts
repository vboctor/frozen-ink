import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomBytes } from "crypto";
import { z } from "zod";
import yaml from "js-yaml";
import { getFrozenInkHome } from "./loader";

// --- Zod Schemas ---

const collectionEntrySchema = z.object({
  title: z.string().optional(),
  crawler: z.string(),
  enabled: z.boolean().optional().default(true),
  syncInterval: z.number().optional(),
  config: z.record(z.unknown()).default({}),
  credentials: z.record(z.unknown()).default({}),
});

const deploymentEntrySchema = z.object({
  url: z.string(),
  mcpUrl: z.string(),
  collections: z.array(z.string()),
  d1DatabaseId: z.string(),
  d1DatabaseName: z.string().optional(),
  r2BucketName: z.string(),
  cfAccountId: z.string().optional(),
  passwordProtected: z.boolean(),
  publishedAt: z.string(),
});

const frozenInkSchema = z.object({
  collections: z.record(collectionEntrySchema).default({}),
  deployments: z.record(deploymentEntrySchema).default({}),
});

// --- Types ---

export type CollectionEntry = z.infer<typeof collectionEntrySchema>;
export type CollectionEntryInput = z.input<typeof collectionEntrySchema>;
export type DeploymentEntry = z.infer<typeof deploymentEntrySchema>;
export type FrozenInkYaml = z.infer<typeof frozenInkSchema>;

// --- Paths ---

function getContextPath(): string {
  return join(getFrozenInkHome(), "context.yml");
}

// --- Load / Save ---

export function loadContext(): FrozenInkYaml {
  const contextPath = getContextPath();
  if (!existsSync(contextPath)) {
    return { collections: {}, deployments: {} };
  }
  const raw = readFileSync(contextPath, "utf-8");
  const parsed = yaml.load(raw) as Record<string, unknown> | null;
  return frozenInkSchema.parse(parsed ?? {});
}

export function saveContext(ctx: FrozenInkYaml): void {
  const contextPath = getContextPath();
  const dir = dirname(contextPath);
  mkdirSync(dir, { recursive: true });

  const content = yaml.dump(ctx, { lineWidth: -1, noRefs: true, sortKeys: false });
  // Atomic write: write to temp file then rename
  const tmpPath = `${contextPath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, contextPath);
}

export function contextExists(): boolean {
  return existsSync(getContextPath());
}

// --- Collection CRUD ---

export function getCollection(name: string): (CollectionEntry & { name: string }) | null {
  const ctx = loadContext();
  const entry = ctx.collections[name];
  if (!entry) return null;
  return { ...entry, name };
}

export function listCollections(): Array<CollectionEntry & { name: string }> {
  const ctx = loadContext();
  return Object.entries(ctx.collections).map(([name, entry]) => ({ ...entry, name }));
}

export function getCollectionDbPath(name: string): string {
  const home = getFrozenInkHome();
  return join(home, "collections", name, "data.db");
}

export function addCollection(name: string, entry: CollectionEntryInput): void {
  const ctx = loadContext();
  ctx.collections[name] = collectionEntrySchema.parse(entry);
  saveContext(ctx);
}

export function removeCollection(name: string): void {
  const ctx = loadContext();
  delete ctx.collections[name];
  saveContext(ctx);
}

export function updateCollection(name: string, updates: Partial<CollectionEntry>): void {
  const ctx = loadContext();
  const existing = ctx.collections[name];
  if (!existing) return;
  ctx.collections[name] = { ...existing, ...updates };
  saveContext(ctx);
}

export function renameCollection(oldName: string, newName: string): void {
  const ctx = loadContext();
  const entry = ctx.collections[oldName];
  if (!entry) return;
  delete ctx.collections[oldName];
  ctx.collections[newName] = entry;
  saveContext(ctx);
}

// --- Deployment CRUD ---

export function addDeployment(name: string, entry: DeploymentEntry): void {
  const ctx = loadContext();
  ctx.deployments[name] = entry;
  saveContext(ctx);
}

export function removeDeployment(name: string): void {
  const ctx = loadContext();
  delete ctx.deployments[name];
  saveContext(ctx);
}

export function getDeployment(nameOrUrl: string): (DeploymentEntry & { name: string }) | null {
  const ctx = loadContext();
  // Try by name first
  if (ctx.deployments[nameOrUrl]) {
    return { ...ctx.deployments[nameOrUrl], name: nameOrUrl };
  }
  // Try by URL
  for (const [name, entry] of Object.entries(ctx.deployments)) {
    if (entry.url === nameOrUrl || entry.mcpUrl === nameOrUrl) {
      return { ...entry, name };
    }
  }
  return null;
}

export function listDeployments(): Array<DeploymentEntry & { name: string }> {
  const ctx = loadContext();
  return Object.entries(ctx.deployments).map(([name, entry]) => ({ ...entry, name }));
}
