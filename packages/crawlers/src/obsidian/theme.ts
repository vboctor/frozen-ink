import type { Theme, ThemeRenderContext } from "@veecontext/core/theme";

export class ObsidianTheme implements Theme {
  crawlerType = "obsidian";

  render(context: ThemeRenderContext): string {
    // Obsidian vault files are already markdown — pass through as-is
    const content = context.entity.data.content as string;
    return content;
  }

  getFilePath(context: ThemeRenderContext): string {
    // Preserve the original vault-relative path
    return context.entity.data.relativePath as string;
  }
}
