import { computeEntityHash, type HashableEntity } from "@frozenink/core";

/**
 * Reject paths that could escape the collection directory.
 * Call this for every markdownPath / storagePath received from a remote server.
 */
export function assertSafePath(p: string): void {
  if (!p || p.startsWith("/") || p.startsWith("\\")) {
    throw new Error(`Unsafe remote path (absolute): ${p}`);
  }
  const segments = p.split(/[\\/]/);
  if (segments.includes("..") || segments.includes(".")) {
    throw new Error(`Unsafe remote path (traversal): ${p}`);
  }
}

export interface ManifestEntity {
  externalId: string;
  hash: string;
}

export interface RemoteEntityData {
  externalId: string;
  entityType: string;
  title: string;
  data: Record<string, unknown>;
  hash: string;
  markdownPath: string | null;
  url: string | null;
  tags: string[];
  outLinks: string[];
  inLinks: string[];
  assets: Array<{ filename: string; mimeType: string; storagePath: string; hash: string }>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FileOp {
  path: string;
  entityExternalId: string;
  type: "markdown" | "html" | "asset";
}

export interface MoveOp {
  from: string;
  to: string;
  hash: string;
}

export interface SyncPlan {
  entities: {
    add: ManifestEntity[];
    update: ManifestEntity[];
    delete: string[];
  };
  files: {
    download: FileOp[];
    delete: FileOp[];
    move: MoveOp[];
  };
}

export interface LocalEntity {
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

export function computeSyncPlan(
  localEntities: LocalEntity[],
  remoteManifest: ManifestEntity[],
  remoteEntities?: RemoteEntityData[],
): SyncPlan {
  const localByExtId = new Map<string, LocalEntity>();
  const localHashByExtId = new Map<string, string>();

  for (const entity of localEntities) {
    localByExtId.set(entity.externalId, entity);
    localHashByExtId.set(entity.externalId, computeEntityHash(entity as HashableEntity));
  }

  const remoteByExtId = new Map<string, ManifestEntity>();
  for (const entry of remoteManifest) {
    remoteByExtId.set(entry.externalId, entry);
  }

  const add: ManifestEntity[] = [];
  const update: ManifestEntity[] = [];
  const deleteIds: string[] = [];

  const downloads: FileOp[] = [];
  const deletes: FileOp[] = [];
  const moves: MoveOp[] = [];

  // Entities to add (in remote but not local)
  for (const [extId, remote] of remoteByExtId) {
    if (!localByExtId.has(extId)) {
      add.push(remote);
    }
  }

  // Entities to update (hash differs)
  for (const [extId, remote] of remoteByExtId) {
    if (localByExtId.has(extId)) {
      const localHash = localHashByExtId.get(extId)!;
      if (localHash !== remote.hash) {
        update.push(remote);
      }
    }
  }

  // Entities to delete (local but not in remote)
  for (const extId of localByExtId.keys()) {
    if (!remoteByExtId.has(extId)) {
      deleteIds.push(extId);
    }
  }

  // Build remote entity lookup for detailed file ops
  const remoteEntityMap = new Map<string, RemoteEntityData>();
  if (remoteEntities) {
    for (const re of remoteEntities) {
      remoteEntityMap.set(re.externalId, re);
    }
  }

  // File operations for added entities
  for (const entry of add) {
    const remote = remoteEntityMap.get(entry.externalId);
    if (remote?.markdownPath) {
      downloads.push({ path: remote.markdownPath, entityExternalId: entry.externalId, type: "markdown" });
    }
    if (remote?.assets) {
      for (const asset of remote.assets) {
        downloads.push({ path: asset.storagePath, entityExternalId: entry.externalId, type: "asset" });
      }
    }
  }

  // File operations for updated entities (detect moves vs content changes)
  for (const entry of update) {
    const remote = remoteEntityMap.get(entry.externalId);
    const local = localByExtId.get(entry.externalId);
    if (!remote || !local) continue;

    if (remote.markdownPath && local.markdownPath && remote.markdownPath !== local.markdownPath) {
      // Path changed — could be a move
      const localDataHash = computeEntityHash({ ...local, markdownPath: remote.markdownPath } as HashableEntity);
      if (localDataHash === remote.hash) {
        moves.push({ from: local.markdownPath, to: remote.markdownPath, hash: remote.hash });
        continue;
      }
    }

    if (remote.markdownPath) {
      downloads.push({ path: remote.markdownPath, entityExternalId: entry.externalId, type: "markdown" });
    }

    // Check asset changes
    const localAssetsByPath = new Map((local.assets ?? []).map((a) => [a.storagePath, a]));
    const remoteAssetsByPath = new Map((remote.assets ?? []).map((a) => [a.storagePath, a]));

    for (const [path, remoteAsset] of remoteAssetsByPath) {
      const localAsset = localAssetsByPath.get(path);
      if (!localAsset || localAsset.hash !== remoteAsset.hash) {
        downloads.push({ path, entityExternalId: entry.externalId, type: "asset" });
      }
    }

    for (const [path] of localAssetsByPath) {
      if (!remoteAssetsByPath.has(path)) {
        deletes.push({ path, entityExternalId: entry.externalId, type: "asset" });
      }
    }
  }

  // File operations for deleted entities
  for (const extId of deleteIds) {
    const local = localByExtId.get(extId);
    if (!local) continue;
    if (local.markdownPath) {
      deletes.push({ path: local.markdownPath, entityExternalId: extId, type: "markdown" });
    }
    for (const asset of local.assets ?? []) {
      deletes.push({ path: asset.storagePath, entityExternalId: extId, type: "asset" });
    }
  }

  return {
    entities: { add, update, delete: deleteIds },
    files: { download: downloads, delete: deletes, move: moves },
  };
}

export function printSyncPlan(plan: SyncPlan): void {
  const { entities, files } = plan;

  console.log(
    `Entities:  +${entities.add.length} added, ~${entities.update.length} updated, -${entities.delete.length} deleted`,
  );

  if (files.download.length > 0 || files.delete.length > 0 || files.move.length > 0) {
    console.log("");
    console.log("Files:");
    if (files.download.length > 0) {
      const mdCount = files.download.filter((f) => f.type === "markdown").length;
      const assetCount = files.download.filter((f) => f.type === "asset").length;
      const parts = [];
      if (mdCount > 0) parts.push(`${mdCount} markdown`);
      if (assetCount > 0) parts.push(`${assetCount} assets`);
      console.log(`  Download:  ${files.download.length} files (${parts.join(", ")})`);
    }
    if (files.delete.length > 0) {
      console.log(`  Delete:    ${files.delete.length} files`);
    }
    if (files.move.length > 0) {
      for (const m of files.move) {
        console.log(`  Move:      ${m.from} -> ${m.to}`);
      }
    }
  }
}

export function isSyncPlanEmpty(plan: SyncPlan): boolean {
  return (
    plan.entities.add.length === 0 &&
    plan.entities.update.length === 0 &&
    plan.entities.delete.length === 0 &&
    plan.files.download.length === 0 &&
    plan.files.delete.length === 0 &&
    plan.files.move.length === 0
  );
}
