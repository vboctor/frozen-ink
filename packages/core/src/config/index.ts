export { configSchema, type FrozenInkConfig, type SyncConfig, type UiConfig } from "./schema";
export { defaultConfig } from "./defaults";
export { loadConfig, getFrozenInkHome } from "./loader";
export {
  loadContext,
  saveContext,
  contextExists,
  ensureInitialized,
  migrateFromLegacyContext,
  getCollection,
  listCollections,
  getCollectionDbPath,
  addCollection,
  removeCollection,
  updateCollection,
  renameCollection,
  getCollectionPublishState,
  updateCollectionPublishState,
  clearCollectionPublishState,
  listPublishedCollections,
  type CollectionEntry,
  type CollectionEntryInput,
  type PublishState,
  type FrozenInkYaml,
} from "./context";
