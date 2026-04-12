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
  addSite,
  removeSite,
  getSite,
  listSites,
  updateSiteState,
  // Deprecated aliases
  addDeployment,
  removeDeployment,
  getDeployment,
  listDeployments,
  type CollectionEntry,
  type CollectionEntryInput,
  type SiteEntry,
  type DeploymentEntry,
  type FrozenInkYaml,
} from "./context";
