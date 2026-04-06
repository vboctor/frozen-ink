export { configSchema, type VeeContextConfig, type DbConfig, type StorageConfig, type SyncConfig, type UiConfig, type McpConfig, type LoggingConfig } from "./schema";
export { defaultConfig } from "./defaults";
export { loadConfig, getVeeContextHome } from "./loader";
export {
  loadContext,
  saveContext,
  contextExists,
  getCollection,
  listCollections,
  getCollectionDbPath,
  addCollection,
  removeCollection,
  updateCollection,
  renameCollection,
  addDeployment,
  removeDeployment,
  getDeployment,
  listDeployments,
  type CollectionEntry,
  type CollectionEntryInput,
  type DeploymentEntry,
  type VeeContextYaml,
} from "./context";
