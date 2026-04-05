import type { Theme, ThemeRenderContext } from "./interface";

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
}
