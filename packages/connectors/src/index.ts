import { ConnectorRegistry } from "@veecontext/core";
import { GitHubConnector } from "./github/connector";
import { GitHubTheme } from "./github/theme";

export { GitHubConnector } from "./github/connector";
export { GitHubTheme } from "./github/theme";
export type { GitHubConfig, GitHubCredentials } from "./github/types";

export function createDefaultRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register("github", () => new GitHubConnector());
  return registry;
}

export const gitHubTheme = new GitHubTheme();
