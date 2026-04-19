export interface RssConfig {
  /** RSS/Atom feed URL */
  feedUrl: string;
  /** Optional website URL used for sitemap discovery */
  siteUrl?: string;
  /** Optional cap for number of entities emitted per sync run */
  maxItems?: number;
  /** Backfill older posts from sitemaps on first sync (default: true) */
  sitemapBackfill?: boolean;
  /** Fetch article HTML when feed content is missing (default: true) */
  fetchArticleContent?: boolean;
}

export interface RssCredentials {
  // Reserved for future auth support
}

export interface ParsedFeedPost {
  id: string;
  url: string;
  title: string;
  publishedAt?: string;
  updatedAt?: string;
  author?: string;
  tags: string[];
  summary?: string;
  contentHtml?: string;
  imageUrls: string[];
}

export interface ParsedSitemap {
  type: "index" | "urlset";
  sitemapUrls: string[];
  pageUrls: Array<{ url: string; lastmod?: string }>;
}

export interface RssSyncCursor {
  watermark?: string;
  seenIds?: string[];
  backfillComplete?: boolean;
}
