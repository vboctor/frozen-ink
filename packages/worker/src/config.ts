export interface CollectionConfig {
  name: string;
  title?: string;
  crawler?: string;
  description?: string;
}

export async function getCollections(bucket: R2Bucket): Promise<CollectionConfig[]> {
  const obj = await bucket.get("_config/collections.yml");
  if (!obj) return [];
  const text = await obj.text();
  return parseCollectionsYml(text);
}

export async function getCollectionConfig(bucket: R2Bucket, name: string): Promise<CollectionConfig | null> {
  const obj = await bucket.get(`_config/${name}.yml`);
  if (!obj) return null;
  const text = await obj.text();
  return parseCollectionYml(name, text);
}

function parseCollectionsYml(text: string): CollectionConfig[] {
  const configs: CollectionConfig[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^- (.+)$/);
    if (m) configs.push({ name: m[1].trim() });
  }
  return configs;
}

function parseCollectionYml(name: string, text: string): CollectionConfig {
  const config: CollectionConfig = { name };
  for (const line of text.split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    const v = val.trim();
    if (key === "title") config.title = v;
    if (key === "crawler") config.crawler = v;
    if (key === "description") config.description = v;
  }
  return config;
}
