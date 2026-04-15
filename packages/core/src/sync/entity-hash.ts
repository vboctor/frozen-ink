import { createCryptoHasher } from "../compat/crypto";
import type { EntityData } from "../db/collection-schema";

export interface HashableEntity {
  entityType: string;
  title: string;
  data: EntityData | string;
}

export function computeEntityHash(entity: HashableEntity): string {
  let d: EntityData;
  if (typeof entity.data === "string") {
    try { d = JSON.parse(entity.data); } catch { d = { source: {} }; }
  } else {
    d = entity.data ?? { source: {} };
  }

  const tags = [...(d.tags ?? [])].sort();
  const out_links = [...(d.out_links ?? [])].sort();
  const in_links = [...(d.in_links ?? [])].sort();
  const assets = [...(d.assets ?? [])].sort((a, b) => a.filename.localeCompare(b.filename));

  const canonical = JSON.stringify({
    entityType: entity.entityType,
    title: entity.title,
    source: d.source ?? {},
    out_links,
    in_links,
    assets,
    markdown_mtime: d.markdown_mtime ?? null,
    markdown_size: d.markdown_size ?? null,
    markdown_path: d.markdown_path ?? null,
    url: d.url ?? null,
    tags,
  });

  const hasher = createCryptoHasher("sha256");
  hasher.update(canonical);
  return hasher.digest("hex");
}
