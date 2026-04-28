export * from "./collection-schema";
export { getCollectionDb, isValidCollectionKey } from "./client";
export {
  MetadataStore,
  getCollectionSyncState,
  updateCollectionSyncState,
  writeCollectionConfigMirror,
} from "./metadata";
export type { SyncStateSnapshot, SyncStateUpdate } from "./metadata";
export {
  runSyncMigrations,
  runAsyncMigrations,
  LOCAL_MIGRATIONS,
  WORKER_MIGRATIONS,
  FTS_RESET_FROM_BELOW,
  SCHEMA_VERSION_KEY,
  type SyncMigration,
  type AsyncMigration,
  type SyncMigrationDb,
  type AsyncMigrationDb,
  type MigrationResult,
} from "./migrations";
