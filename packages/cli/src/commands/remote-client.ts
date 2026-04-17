import type { ManifestEntity, RemoteEntityData } from "./sync-plan";

export interface ManifestResponse {
  version: number;
  capabilities: string[];
  collection: {
    name: string;
    title: string;
    crawlerType: string;
  };
  entities: string;
}

export class RemoteClient {
  private baseUrl: string;
  private password: string | undefined;
  private collectionName: string | undefined;

  constructor(baseUrl: string, password?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.password = password;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "X-Fink-Client-Version": "1",
    };
    if (this.password) {
      h["Authorization"] = `Bearer ${this.password}`;
    }
    return h;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private async fetchBytes(path: string): Promise<Uint8Array | null> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  private async fetchText(path: string): Promise<string | null> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return res.text();
  }

  async getManifest(): Promise<{ manifest: ManifestResponse; entries: ManifestEntity[] }> {
    // Try _default alias first; a 404 means the server uses explicit collection names only
    let manifest: ManifestResponse | undefined;
    try {
      manifest = await this.fetchJson<ManifestResponse>("/api/collections/_default/manifest");
      if (manifest.collection?.name) {
        this.collectionName = manifest.collection.name;
      }
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("HTTP 404 ")) throw err;
    }

    // Fall back to enumerating collections when _default is not found or returned no name
    if (!this.collectionName) {
      const collections = await this.fetchJson<Array<{ name: string }>>("/api/collections");
      if (collections.length > 0) {
        this.collectionName = collections[0].name;
        const retried = await this.fetchJson<ManifestResponse>(
          `/api/collections/${encodeURIComponent(this.collectionName)}/manifest`,
        );
        if (retried.version > 1) {
          throw new Error(`Unsupported manifest version: ${retried.version}. Please update fink.`);
        }
        return { manifest: retried, entries: parseManifestEntities(retried.entities) };
      }
    }

    if (!manifest) {
      throw new Error("No collections found on remote site.");
    }

    if (manifest.version > 1) {
      throw new Error(`Unsupported manifest version: ${manifest.version}. Please update fink.`);
    }

    return { manifest, entries: parseManifestEntities(manifest.entities) };
  }

  async getEntitiesBulk(externalIds: string[]): Promise<RemoteEntityData[]> {
    const name = this.collectionName ?? "_default";
    const batchSize = 50;
    const results: RemoteEntityData[] = [];

    for (let i = 0; i < externalIds.length; i += batchSize) {
      const batch = externalIds.slice(i, i + batchSize);
      const idsParam = batch.map(encodeURIComponent).join(",");
      const response = await this.fetchJson<{ entities: RemoteEntityData[] }>(
        `/api/collections/${encodeURIComponent(name)}/entities/bulk?externalIds=${idsParam}`,
      );
      results.push(...response.entities);
    }

    return results;
  }

  async getMarkdown(path: string): Promise<string | null> {
    const name = this.collectionName ?? "_default";
    return this.fetchText(`/api/collections/${encodeURIComponent(name)}/markdown/${encodeURIComponent(path)}`);
  }

  async getHtml(path: string): Promise<string | null> {
    const name = this.collectionName ?? "_default";
    return this.fetchText(`/api/collections/${encodeURIComponent(name)}/html/${encodeURIComponent(path)}`);
  }

  async getFile(path: string): Promise<Uint8Array | null> {
    const name = this.collectionName ?? "_default";
    return this.fetchBytes(`/api/attachments/${encodeURIComponent(name)}/${encodeURIComponent(path)}`);
  }

  getCollectionName(): string | undefined {
    return this.collectionName;
  }
}

function parseManifestEntities(entitiesStr: string): ManifestEntity[] {
  if (!entitiesStr) return [];
  return entitiesStr.split("\n").filter(Boolean).map((line) => {
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) return { externalId: line, hash: "" };
    return {
      externalId: line.slice(0, tabIdx),
      hash: line.slice(tabIdx + 1),
    };
  });
}
