import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FolderConfig, Theme, ThemeRenderContext } from "@frozenink/core/theme";
import { wikilink, embed, basename } from "@frozenink/core/theme";

export class ObsidianTheme implements Theme {
  crawlerType = "obsidian";

  render(context: ThemeRenderContext): string {
    const content = context.entity.data.content as string;
    const sourcePath = this.getFilePath(context);
    const imageRefMap = (context.entity.data.imageRefMap ?? {}) as Record<string, string>;

    let result = content;

    // Convert Obsidian image embeds: ![[path]] → standard markdown image
    result = result.replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_match, ref: string) => {
      const resolvedPath = imageRefMap[ref] ?? ref;
      return embed(resolvedPath, sourcePath);
    });

    // Convert Obsidian wikilinks: [[target|label]] and [[target]]
    // Uses resolveWikilink for stem matching (bare names like [[Topic]] that
    // may refer to files in different folders).
    result = result.replace(
      /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
      (_match, target: string, label: string) => {
        const resolved = this.resolveTarget(target, context);
        if (resolved) return wikilink(resolved, label, sourcePath);
        // Unresolved — keep as plain text with label
        return label;
      },
    );
    result = result.replace(
      /\[\[([^\]]+)\]\]/g,
      (_match, target: string) => {
        // Strip section anchors for resolution but keep for display
        const cleanTarget = target.replace(/[#^].*$/, "").trim();
        const label = cleanTarget.includes("/") ? cleanTarget.split("/").pop()! : cleanTarget;
        const resolved = this.resolveTarget(cleanTarget, context);
        if (resolved) return wikilink(resolved, label, sourcePath);
        // Unresolved — render as plain text
        return label;
      },
    );

    // Add H1 header from filename if content doesn't have one
    result = this.ensureH1(result, sourcePath);

    return result;
  }

  labelFilesWithTitle() {
    return false;
  }

  getSourceFolderConfigs(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Record<string, FolderConfig> {
    const vaultPath = (credentials.vaultPath ?? config.vaultPath) as string | undefined;
    if (!vaultPath || !existsSync(vaultPath)) return {};
    return this.readVaultFolderConfigs(vaultPath, vaultPath, "");
  }

  private readVaultFolderConfigs(
    vaultPath: string,
    dirPath: string,
    relPath: string,
  ): Record<string, FolderConfig> {
    const result: Record<string, FolderConfig> = {};

    const dotyml = join(dirPath, ".folder.yml");
    if (existsSync(dotyml)) {
      const cfg = this.parseFolderYml(dotyml);
      if (Object.keys(cfg).length > 0) result[relPath] = cfg;
    }

    let entries;
    try { entries = readdirSync(dirPath, { withFileTypes: true }); } catch { return result; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      const childAbs = join(dirPath, entry.name);
      Object.assign(result, this.readVaultFolderConfigs(vaultPath, childAbs, childRel));
    }

    return result;
  }

  private parseFolderYml(ymlPath: string): FolderConfig {
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

  folderConfigs() {
    return {
      assets: { visible: false },
    };
  }

  agentsMarkdown(options: { title: string; description?: string }): string {
    const { title, description } = options;
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    if (description) {
      lines.push(description);
    } else {
      lines.push("This collection is synced from an Obsidian vault. Notes preserve their original vault folder structure.");
    }
    lines.push("");
    lines.push("## Content");
    lines.push("");
    lines.push("### Notes");
    lines.push("Markdown notes from the vault, with Obsidian-style wikilinks converted to standard Markdown links. The folder hierarchy matches the original vault layout.");
    return lines.join("\n") + "\n";
  }

  getFilePath(context: ThemeRenderContext): string {
    // Preserve the original vault-relative path
    return context.entity.data.relativePath as string;
  }

  /**
   * Resolve an Obsidian wikilink target to a markdown path (without .md extension).
   * Tries the context's resolveWikilink (stem matching) first, then falls back
   * to lookupEntityPath with common externalId patterns.
   */
  private resolveTarget(target: string, context: ThemeRenderContext): string | undefined {
    if (context.resolveWikilink) {
      return context.resolveWikilink(target);
    }
    // Fallback: try lookupEntityPath with .md suffix
    const withMd = target.endsWith(".md") ? target : `${target}.md`;
    return context.lookupEntityPath?.(withMd);
  }

  /**
   * If the markdown content has no H1 heading (after frontmatter), prepend one
   * derived from the filename.
   */
  private ensureH1(content: string, sourcePath: string): string {
    let body = content;
    let frontmatterBlock = "";

    // Extract frontmatter if present
    if (body.startsWith("---")) {
      const endIdx = body.indexOf("---", 3);
      if (endIdx !== -1) {
        frontmatterBlock = body.slice(0, endIdx + 3);
        body = body.slice(endIdx + 3);
      }
    }

    // Strip fenced code blocks to avoid false H1 matches
    const stripped = body.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?\n\1\s*$/gm, "");
    const hasH1 = /^#\s+.+$/m.test(stripped);

    if (hasH1) return content;

    // Derive title from filename
    const filename = basename(sourcePath, ".md");
    const title = `# ${filename}\n\n`;

    if (frontmatterBlock) {
      return `${frontmatterBlock}\n\n${title}${body.trimStart()}`;
    }
    return `${title}${body.trimStart()}`;
  }
}
