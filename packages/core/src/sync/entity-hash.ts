import { createCryptoHasher } from "../compat/crypto";

export interface HashableEntity {
  externalId: string;
  entityType: string;
  title: string;
  data: Record<string, unknown> | string;
  markdownPath: string | null;
  url: string | null;
  tags: string[] | null;
  outLinks: string[] | null;
  inLinks: string[] | null;
  assets: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }> | null;
}

export function computeEntityHash(entity: HashableEntity): string {
  const tags = [...(entity.tags ?? [])].sort();
  const outLinks = [...(entity.outLinks ?? [])].sort();
  const inLinks = [...(entity.inLinks ?? [])].sort();
  const assets = [...(entity.assets ?? [])].sort((a, b) => a.filename.localeCompare(b.filename));

  const data = typeof entity.data === "string" ? entity.data : JSON.stringify(entity.data);

  const canonical = JSON.stringify({
    externalId: entity.externalId,
    entityType: entity.entityType,
    title: entity.title,
    data,
    markdownPath: entity.markdownPath,
    url: entity.url,
    tags,
    outLinks,
    inLinks,
    assets,
  });

  const hasher = createCryptoHasher("sha256");
  hasher.update(canonical);
  return hasher.digest("hex");
}
