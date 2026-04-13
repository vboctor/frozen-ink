export interface FolderConfig {
  /** Whether this folder is visible in the file tree (default: true). */
  visible?: boolean;
  /** Sort order for files in this folder (default: ASC). */
  sort?: "ASC" | "DESC";
}

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
  /**
   * Resolve an Obsidian-style wikilink target (bare name or path) to a markdown
   * file path (relative to markdown root, without .md extension).
   * Supports stem matching: "Topic" matches "subfolder/Topic.md".
   */
  resolveWikilink?: (target: string) => string | undefined;
}

export interface Theme {
  crawlerType: string;
  render(context: ThemeRenderContext): string;
  getFilePath(context: ThemeRenderContext): string;
  /**
   * Optional: render entity data as styled HTML instead of markdown.
   * The HTML should use CSS custom properties (var(--bg), var(--text), etc.)
   * so it adapts to the selected UI theme.
   * Returns null/undefined if not supported for this entity.
   */
  renderHtml?(context: ThemeRenderContext): string | null;
  /**
   * Optional: derive the display title from stored entity data.
   * Used during re-generation to update the title in the DB without re-fetching
   * from the source API. Returns undefined if the theme cannot derive a title.
   */
  getTitle?(context: ThemeRenderContext): string | undefined;
  /**
   * Optional: return folder-level display configs keyed by folder name.
   * Any folder whose leaf name matches a key inherits the associated config,
   * regardless of depth (e.g. "issues" matches both "issues/" and "project/issues/").
   * The sync engine writes these as <folder-name>.yml inside each matching folder.
   */
  folderConfigs?(): Record<string, FolderConfig>;
}
