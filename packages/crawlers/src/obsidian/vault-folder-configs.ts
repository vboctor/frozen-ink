import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FolderConfig } from "@frozenink/core/theme";

// Reads `.folder.yml` files from an Obsidian vault directory tree and returns
// them keyed by vault-relative folder path (root = "").
//
// Lives outside ObsidianTheme because ObsidianTheme is bundled into the
// Cloudflare Worker, which has no `node:fs`. This helper is only imported by
// publish/prepare in the CLI (Node/Bun).
export function readVaultFolderConfigs(
  vaultPath: string,
): Record<string, FolderConfig> {
  if (!existsSync(vaultPath)) return {};
  return readDir(vaultPath, "");
}

function readDir(dirPath: string, relPath: string): Record<string, FolderConfig> {
  const result: Record<string, FolderConfig> = {};

  const dotyml = join(dirPath, ".folder.yml");
  if (existsSync(dotyml)) {
    const cfg = parseFolderYml(dotyml);
    if (Object.keys(cfg).length > 0) result[relPath] = cfg;
  }

  let entries;
  try { entries = readdirSync(dirPath, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    const childAbs = join(dirPath, entry.name);
    Object.assign(result, readDir(childAbs, childRel));
  }

  return result;
}

function parseFolderYml(ymlPath: string): FolderConfig {
  try {
    const cfg: FolderConfig = {};
    for (const line of readFileSync(ymlPath, "utf-8").split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (key === "sort") cfg.sort = val.trim() === "DESC" ? "DESC" : "ASC";
      if (key === "visible") cfg.visible = val.trim() !== "false";
      if (key === "showCount") cfg.showCount = val.trim() === "true";
      if (key === "expanded") cfg.expanded = val.trim() !== "false";
    }
    return cfg;
  } catch {
    return {};
  }
}
