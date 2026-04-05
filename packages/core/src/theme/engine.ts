import type { Theme, ThemeRenderContext } from "./interface";

export class ThemeEngine {
  private themes = new Map<string, Theme>();

  register(theme: Theme): void {
    this.themes.set(theme.connectorType, theme);
  }

  has(connectorType: string): boolean {
    return this.themes.has(connectorType);
  }

  render(context: ThemeRenderContext): string {
    const theme = this.themes.get(context.connectorType);
    if (!theme) {
      throw new Error(`No theme registered for connector type: ${context.connectorType}`);
    }
    return theme.render(context);
  }

  getFilePath(context: ThemeRenderContext): string {
    const theme = this.themes.get(context.connectorType);
    if (!theme) {
      throw new Error(`No theme registered for connector type: ${context.connectorType}`);
    }
    return theme.getFilePath(context);
  }
}
