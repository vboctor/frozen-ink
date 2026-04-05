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
  /**
   * Look up the markdown file path (relative, without extension) for any entity
   * by its externalId. Returns undefined if the entity is not yet in the DB.
   * Used by themes to generate correct cross-reference wikilinks.
   */
  lookupEntityPath?: (externalId: string) => string | undefined;
}

export interface Theme {
  crawlerType: string;
  render(context: ThemeRenderContext): string;
  getFilePath(context: ThemeRenderContext): string;
}
