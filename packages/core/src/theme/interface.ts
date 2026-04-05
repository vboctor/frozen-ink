export interface ThemeRenderContext {
  entity: {
    externalId: string;
    entityType: string;
    title: string;
    data: Record<string, unknown>;
    url?: string;
    tags?: string[];
  };
  collectionName: string;
  crawlerType: string;
}

export interface Theme {
  crawlerType: string;
  render(context: ThemeRenderContext): string;
  getFilePath(context: ThemeRenderContext): string;
}
