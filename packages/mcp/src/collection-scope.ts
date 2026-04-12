import type { McpServerOptions } from "./server";

export function normalizeAllowedCollections(
  options: McpServerOptions,
): Set<string> | null {
  if (!options.allowedCollections || options.allowedCollections.length === 0) {
    return null;
  }
  return new Set(options.allowedCollections);
}

export function isCollectionAllowed(
  options: McpServerOptions,
  collectionName: string,
): boolean {
  const allowed = normalizeAllowedCollections(options);
  if (!allowed) return true;
  return allowed.has(collectionName);
}

export function filterAllowedCollectionNames(
  options: McpServerOptions,
  collectionNames: string[],
): string[] {
  const allowed = normalizeAllowedCollections(options);
  if (!allowed) return collectionNames;
  return collectionNames.filter((name) => allowed.has(name));
}

export function filterAllowedCollections<T extends { name: string }>(
  options: McpServerOptions,
  collections: T[],
): T[] {
  const allowed = normalizeAllowedCollections(options);
  if (!allowed) return collections;
  return collections.filter((collection) => allowed.has(collection.name));
}

export function buildCollectionDeniedError(collectionName: string): string {
  return `Collection "${collectionName}" is not allowed for this MCP server`;
}
