export { configSchema, type FrozenInkConfig, type SyncConfig, type UiConfig } from "./schema";
export { defaultConfig } from "./defaults";
export { loadConfig, getFrozenInkHome } from "./loader";
export {
  contextExists,
  ensureInitialized,
  getCollection,
  listCollections,
  getCollectionDbPath,
  addCollection,
  removeCollection,
  updateCollection,
  renameCollection,
  addSite,
  removeSite,
  getSite,
  listSites,
  updateSiteState,
  type CollectionEntry,
  type CollectionEntryInput,
  type SiteEntry,
} from "./context";
