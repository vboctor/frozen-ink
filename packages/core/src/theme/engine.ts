import type { Theme, ThemeRenderContext, FolderConfig } from "./interface";

export class ThemeEngine {
  private themes = new Map<string, Theme>();

  register(theme: Theme): void {
    this.themes.set(theme.crawlerType, theme);
  }

  has(crawlerType: string): boolean {
    return this.themes.has(crawlerType);
  }

  render(context: ThemeRenderContext): string {
    const theme = this.themes.get(context.crawlerType);
    if (!theme) {
      throw new Error(`No theme registered for crawler type: ${context.crawlerType}`);
    }
    return theme.render(context);
  }

  getFilePath(context: ThemeRenderContext): string {
    const theme = this.themes.get(context.crawlerType);
    if (!theme) {
      throw new Error(`No theme registered for crawler type: ${context.crawlerType}`);
    }
    return theme.getFilePath(context);
  }

  getTitle(context: ThemeRenderContext): string | undefined {
    const theme = this.themes.get(context.crawlerType);
    return theme?.getTitle?.(context);
  }

  hasHtmlRenderer(crawlerType: string): boolean {
    const theme = this.themes.get(crawlerType);
    return !!theme?.renderHtml;
  }

  renderHtml(context: ThemeRenderContext): string | null {
    const theme = this.themes.get(context.crawlerType);
    if (!theme?.renderHtml) return null;
    return theme.renderHtml(context);
  }

  /** Return folder configs for the given crawler type, or empty object if none defined. */
  getFolderConfigs(crawlerType: string): Record<string, FolderConfig> {
    const theme = this.themes.get(crawlerType);
    return theme?.folderConfigs?.() ?? {};
  }

  /** Read folder configs from the source vault/directory (theme-specific). */
  getSourceFolderConfigs(
    crawlerType: string,
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Record<string, FolderConfig> {
    const theme = this.themes.get(crawlerType);
    return theme?.getSourceFolderConfigs?.(config, credentials) ?? {};
  }

  /** Return whether entity titles should label file tree nodes for the given crawler type. */
  labelFilesWithTitle(crawlerType: string): boolean {
    const theme = this.themes.get(crawlerType);
    return theme?.labelFilesWithTitle?.() ?? true;
  }

  /** Return the root config for the given crawler type, or empty object if none defined. */
  getRootConfig(crawlerType: string): FolderConfig {
    const theme = this.themes.get(crawlerType);
    return theme?.rootConfig?.() ?? {};
  }

  /** Generate AGENTS.md content for the given crawler type. Returns null if not supported. */
  agentsMarkdown(
    crawlerType: string,
    options: { title: string; description?: string; config?: Record<string, unknown> },
  ): string | null {
    const theme = this.themes.get(crawlerType);
    if (!theme?.agentsMarkdown) return null;
    return theme.agentsMarkdown(options);
  }
}
