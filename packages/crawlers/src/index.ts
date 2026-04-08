import { CrawlerRegistry } from "@frozenink/core";
import { GitHubCrawler } from "./github/crawler";
import { GitHubTheme } from "./github/theme";
import { ObsidianCrawler } from "./obsidian/crawler";
import { ObsidianTheme } from "./obsidian/theme";
import { GitCrawler } from "./git/crawler";
import { GitTheme } from "./git/theme";
import { MantisBTCrawler } from "./mantisbt/crawler";
import { MantisBTTheme } from "./mantisbt/theme";

export { GitHubCrawler } from "./github/crawler";
export { GitHubTheme } from "./github/theme";
export type { GitHubConfig, GitHubCredentials } from "./github/types";

export { ObsidianCrawler } from "./obsidian/crawler";
export { ObsidianTheme } from "./obsidian/theme";
export type { ObsidianConfig, ObsidianCredentials } from "./obsidian/types";

export { GitCrawler } from "./git/crawler";
export { GitTheme } from "./git/theme";
export type { GitConfig, GitCredentials } from "./git/types";

export { MantisBTCrawler } from "./mantisbt/crawler";
export { MantisBTTheme } from "./mantisbt/theme";
export type { MantisBTConfig, MantisBTCredentials } from "./mantisbt/types";

export function createDefaultRegistry(): CrawlerRegistry {
  const registry = new CrawlerRegistry();
  registry.register("github", () => new GitHubCrawler());
  registry.register("obsidian", () => new ObsidianCrawler());
  registry.register("git", () => new GitCrawler());
  registry.register("mantisbt", () => new MantisBTCrawler());
  return registry;
}

export const gitHubTheme = new GitHubTheme();
export const obsidianTheme = new ObsidianTheme();
export const gitTheme = new GitTheme();
export const mantisBTTheme = new MantisBTTheme();
