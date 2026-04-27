export interface FolderConfig {
  /** Whether this folder is visible in the file tree (default: true). */
  visible?: boolean;
  /** Sort order for both files and subdirectories in this folder (default: ASC). */
  sort?: "ASC" | "DESC";
  /**
   * Glob patterns matching filenames to hide within this folder.
   * Wildcards: * matches any sequence of characters, ? matches one character.
   * Example: ["AGENTS.md", "CLAUDE.md", "*.draft"]
   */
  hide?: string[];
  /**
   * Show a file count next to this folder in the file tree (default: false).
   * Use for folders that hold an unbounded set of entities (issues, pages, users).
   * Leave off for bounded container folders (e.g. a per-project folder whose
   * children are a fixed set of entity-type subfolders plus the project entity).
   */
  showCount?: boolean;
  /**
   * Expand the first N visible child directories by default (default: 0).
   * After sorting, the first N directories in this folder are marked expanded.
   */
  expandFirstN?: number;
  /**
   * Whether this folder starts expanded in the tree (default: true).
   * Set to false to render this folder collapsed by default.
   */
  expanded?: boolean;
  /**
   * Prefix each file's display title with its creation date as `YYYYMMDD `.
   * The date is extracted from the leading 8-character date stamp in the filename.
   */
  created_at_prefix?: boolean;
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
   * Look up the human-readable display title for any entity by its externalId.
   * Themes can use this to label cross-references with the target's title rather
   * than its slug/page-name. Returns undefined if the entity is unknown.
   */
  lookupEntityTitle?: (externalId: string) => string | undefined;
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
  /**
   * Optional: return the config for the content root directory.
   * Merged with collection-level hide patterns and written as content/content.yml
   * during prepare. Use this to specify default visibility or sort settings.
   */
  rootConfig?(): FolderConfig;
  /**
   * Optional: whether to use the entity title as the display label in the
   * file tree. Defaults to true. Set to false for crawlers where the filename
   * is the primary identifier (e.g. Obsidian vaults) so the sidebar always
   * shows the filename rather than the H1 heading.
   */
  labelFilesWithTitle?(): boolean;
  /**
   * Optional: generate the body of AGENTS.md for this collection.
   * Called during prepare to create/update the AI guidance file.
   */
  agentsMarkdown?(options: {
    title: string;
    description?: string;
    config?: Record<string, unknown>;
  }): string;
}
